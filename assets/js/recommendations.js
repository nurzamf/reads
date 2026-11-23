import { isCompletedBook, isToReadBook } from './statistics.js';
import { normalizeAuthorKey, normalizeGenreKey } from './utils.js';

export const DEFAULT_RECOMMENDATION_CONFIG = {
  maxRecommendations: 4,
  minHistoryForPersonalisation: 2,
  weights: {
    genreAffinity: 0.40,
    authorFamiliarity: 0.20,
    lengthBalance: 0.20,
    readingVariety: 0.15,
    personalPreference: 0.05,
  },
};

function buildPreferenceProfile(completedBooks) {
  const genreScores = new Map();
  const authorScores = new Map();

  for (const book of completedBooks) {
    const baseRating = typeof book.rating === 'number' && book.rating > 0 ? book.rating : 3.5;
    const favBoost = book.favourite ? 1.2 : 1;
    const score = baseRating * favBoost;

    for (const genre of book.genres || []) {
      const key = normalizeGenreKey(genre);
      if (!key) continue;
      const existing = genreScores.get(key) || { name: genre, total: 0, count: 0 };
      existing.total += score;
      existing.count += 1;
      genreScores.set(key, existing);
    }

    const authorKey = normalizeAuthorKey(book.author);
    if (authorKey) {
      const existing = authorScores.get(authorKey) || { name: book.author, total: 0, count: 0 };
      existing.total += score;
      existing.count += 1;
      authorScores.set(authorKey, existing);
    }
  }

  const maxGenreAvg = Math.max(
    1,
    ...Array.from(genreScores.values()).map((g) => g.total / g.count)
  );
  const maxAuthorAvg = Math.max(
    1,
    ...Array.from(authorScores.values()).map((a) => a.total / a.count)
  );

  const recentCompleted = [...completedBooks]
    .filter((b) => b.date_finished)
    .sort((a, b) => b.date_finished.localeCompare(a.date_finished));

  const lastCompleted = recentCompleted[0] || completedBooks[0] || null;
  const recentGenres = new Set();
  for (const b of recentCompleted.slice(0, 3)) {
    for (const g of b.genres || []) {
      recentGenres.add(normalizeGenreKey(g));
    }
  }

  return {
    genreScores,
    authorScores,
    maxGenreAvg,
    maxAuthorAvg,
    lastCompleted,
    recentGenres,
  };
}

export function generateRecommendations(books, customConfig = {}) {
  const config = {
    ...DEFAULT_RECOMMENDATION_CONFIG,
    ...customConfig,
    weights: {
      ...DEFAULT_RECOMMENDATION_CONFIG.weights,
      ...(customConfig.weights || {}),
    },
  };

  const toReadBooks = books.filter(isToReadBook);
  if (toReadBooks.length === 0) {
    return {
      hasEnoughHistory: false,
      recommendations: [],
      note: 'Add books to your To Be Read shelf to receive automatic next-up picks.',
    };
  }

  const completedBooks = books.filter(isCompletedBook);
  const ratedCompleted = completedBooks.filter(
    (b) => typeof b.rating === 'number' && b.rating > 0
  );

  const hasEnoughHistory =
    completedBooks.length >= config.minHistoryForPersonalisation && ratedCompleted.length >= 1;

  if (!hasEnoughHistory) {
    const fallbackSorted = [...toReadBooks].sort((a, b) => {
      const rA = a.rating || 0;
      const rB = b.rating || 0;
      if (rB !== rA) return rB - rA;
      return (b.date_added || '').localeCompare(a.date_added || '');
    });

    return {
      hasEnoughHistory: false,
      recommendations: fallbackSorted.slice(0, config.maxRecommendations).map((book) => ({
        book,
        score: null,
        reason:
          book.rating && book.rating >= 4
            ? `Highly rated (${book.rating}/5) in your To Be Read list.`
            : 'Selected from your To Be Read shelf for variety.',
      })),
      note: 'Recommendations will personalise further as more completed and rated books are logged.',
    };
  }

  const profile = buildPreferenceProfile(completedBooks);
  const { weights } = config;
  const lastPages = profile.lastCompleted?.pages || null;

  const scored = toReadBooks.map((book) => {
    const reasons = [];

    // 1. Genre affinity (0..1)
    let genreAffinity = 0;
    let bestGenreName = null;
    for (const genre of book.genres || []) {
      const entry = profile.genreScores.get(normalizeGenreKey(genre));
      if (entry) {
        const normalized = Math.min(1, entry.total / entry.count / profile.maxGenreAvg);
        if (normalized > genreAffinity) {
          genreAffinity = normalized;
          bestGenreName = entry.name;
        }
      }
    }
    if (genreAffinity >= 0.75 && bestGenreName) {
      reasons.push({
        weight: weights.genreAffinity * genreAffinity,
        text: `Matches your favourite genre (${bestGenreName}).`,
      });
    }

    // 2. Author familiarity (0..1)
    let authorFamiliarity = 0;
    const authorEntry = profile.authorScores.get(normalizeAuthorKey(book.author));
    if (authorEntry) {
      const avg = authorEntry.total / authorEntry.count;
      if (avg >= 3.5) {
        authorFamiliarity = Math.min(1, avg / profile.maxAuthorAvg);
        reasons.push({
          weight: weights.authorFamiliarity * authorFamiliarity,
          text: `A familiar author (${book.author}) you rated highly.`,
        });
      }
    }

    // 3. Reading-length balance (0..1)
    let lengthBalance = 0.5;
    if (typeof book.pages === 'number' && book.pages > 0) {
      if (lastPages && lastPages >= 380 && book.pages <= 260) {
        lengthBalance = 1;
        reasons.push({
          weight: weights.lengthBalance,
          text: `A shorter read (${book.pages} pages) after a longer book.`,
        });
      } else if (lastPages && lastPages <= 220 && book.pages >= 300) {
        lengthBalance = 0.85;
        reasons.push({
          weight: weights.lengthBalance * 0.85,
          text: `A substantial next read (${book.pages} pages) after a quick finish.`,
        });
      } else if (book.pages <= 280) {
        lengthBalance = 0.7;
      }
    }

    // 4. Reading variety (0..1)
    let readingVariety = 0;
    const bookGenreKeys = (book.genres || []).map(normalizeGenreKey);
    const hasUnexploredRecentGenre = bookGenreKeys.some((g) => !profile.recentGenres.has(g));
    if (hasUnexploredRecentGenre && book.genres?.length) {
      readingVariety = 0.9;
      const freshGenre = book.genres.find((g) => !profile.recentGenres.has(normalizeGenreKey(g)));
      reasons.push({
        weight: weights.readingVariety * readingVariety,
        text: `A chance to explore ${freshGenre || 'something different'}.`,
      });
    }

    // 5. Personal preference / favourite or pre-rated (0..1)
    let personalPreference = 0;
    if (book.favourite) personalPreference = 1;
    else if (typeof book.rating === 'number' && book.rating >= 4) personalPreference = 0.8;
    else if (book.ownership === 'Owned') personalPreference = 0.5;

    const totalScore =
      weights.genreAffinity * genreAffinity +
      weights.authorFamiliarity * authorFamiliarity +
      weights.lengthBalance * lengthBalance +
      weights.readingVariety * readingVariety +
      weights.personalPreference * personalPreference;

    reasons.sort((a, b) => b.weight - a.weight);

    const fallbackReason = !authorEntry
      ? 'A new author to explore.'
      : 'Balanced pick from your To Be Read collection.';

    return {
      book,
      score: Math.round(totalScore * 100),
      reason: reasons[0]?.text || fallbackReason,
    };
  });

  scored.sort((a, b) => b.score - a.score || a.book.title.localeCompare(b.book.title));

  // Prefer author diversity in top picks before repeating an author
  const diversePicks = [];
  const overflowPicks = [];
  const seenAuthors = new Set();
  for (const item of scored) {
    const aKey = normalizeAuthorKey(item.book.author);
    if (!aKey || !seenAuthors.has(aKey)) {
      if (aKey) seenAuthors.add(aKey);
      diversePicks.push(item);
    } else {
      overflowPicks.push(item);
    }
  }

  const finalPicks = [...diversePicks, ...overflowPicks].slice(0, config.maxRecommendations);

  return {
    hasEnoughHistory: true,
    recommendations: finalPicks,
    note: 'Ranked locally using configurable weights across genre affinity, author familiarity, length balance, and variety.',
  };
}
