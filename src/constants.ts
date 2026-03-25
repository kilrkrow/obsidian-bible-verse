/**
 * USFM book codes used by API.Bible for passage IDs.
 * Maps canonical book name → 3-letter USFM code.
 */
export const USFM_CODES: Record<string, string> = {
  "Genesis": "GEN",
  "Exodus": "EXO",
  "Leviticus": "LEV",
  "Numbers": "NUM",
  "Deuteronomy": "DEU",
  "Joshua": "JOS",
  "Judges": "JDG",
  "Ruth": "RUT",
  "1 Samuel": "1SA",
  "2 Samuel": "2SA",
  "1 Kings": "1KI",
  "2 Kings": "2KI",
  "1 Chronicles": "1CH",
  "2 Chronicles": "2CH",
  "Ezra": "EZR",
  "Nehemiah": "NEH",
  "Esther": "EST",
  "Job": "JOB",
  "Psalms": "PSA",
  "Proverbs": "PRO",
  "Ecclesiastes": "ECC",
  "Song of Solomon": "SNG",
  "Isaiah": "ISA",
  "Jeremiah": "JER",
  "Lamentations": "LAM",
  "Ezekiel": "EZK",
  "Daniel": "DAN",
  "Hosea": "HOS",
  "Joel": "JOL",
  "Amos": "AMO",
  "Obadiah": "OBA",
  "Jonah": "JON",
  "Micah": "MIC",
  "Nahum": "NAM",
  "Habakkuk": "HAB",
  "Zephaniah": "ZEP",
  "Haggai": "HAG",
  "Zechariah": "ZEC",
  "Malachi": "MAL",
  "Matthew": "MAT",
  "Mark": "MRK",
  "Luke": "LUK",
  "John": "JHN",
  "Acts": "ACT",
  "Romans": "ROM",
  "1 Corinthians": "1CO",
  "2 Corinthians": "2CO",
  "Galatians": "GAL",
  "Ephesians": "EPH",
  "Philippians": "PHP",
  "Colossians": "COL",
  "1 Thessalonians": "1TH",
  "2 Thessalonians": "2TH",
  "1 Timothy": "1TI",
  "2 Timothy": "2TI",
  "Titus": "TIT",
  "Philemon": "PHM",
  "Hebrews": "HEB",
  "James": "JAS",
  "1 Peter": "1PE",
  "2 Peter": "2PE",
  "1 John": "1JN",
  "2 John": "2JN",
  "3 John": "3JN",
  "Jude": "JUD",
  "Revelation": "REV",
};

/**
 * Blue Letter Bible 3-letter abbreviations (lowercase).
 */
export const BLB_CODES: Record<string, string> = {
  "Genesis": "gen",
  "Exodus": "exo",
  "Leviticus": "lev",
  "Numbers": "num",
  "Deuteronomy": "deu",
  "Joshua": "jos",
  "Judges": "jdg",
  "Ruth": "rut",
  "1 Samuel": "1sa",
  "2 Samuel": "2sa",
  "1 Kings": "1ki",
  "2 Kings": "2ki",
  "1 Chronicles": "1ch",
  "2 Chronicles": "2ch",
  "Ezra": "ezr",
  "Nehemiah": "neh",
  "Esther": "est",
  "Job": "job",
  "Psalms": "psa",
  "Proverbs": "pro",
  "Ecclesiastes": "ecc",
  "Song of Solomon": "sng",
  "Isaiah": "isa",
  "Jeremiah": "jer",
  "Lamentations": "lam",
  "Ezekiel": "eze",
  "Daniel": "dan",
  "Hosea": "hos",
  "Joel": "joe",
  "Amos": "amo",
  "Obadiah": "oba",
  "Jonah": "jon",
  "Micah": "mic",
  "Nahum": "nah",
  "Habakkuk": "hab",
  "Zephaniah": "zep",
  "Haggai": "hag",
  "Zechariah": "zec",
  "Malachi": "mal",
  "Matthew": "mat",
  "Mark": "mar",
  "Luke": "luk",
  "John": "jhn",
  "Acts": "act",
  "Romans": "rom",
  "1 Corinthians": "1co",
  "2 Corinthians": "2co",
  "Galatians": "gal",
  "Ephesians": "eph",
  "Philippians": "php",
  "Colossians": "col",
  "1 Thessalonians": "1th",
  "2 Thessalonians": "2th",
  "1 Timothy": "1ti",
  "2 Timothy": "2ti",
  "Titus": "tit",
  "Philemon": "phm",
  "Hebrews": "heb",
  "James": "jas",
  "1 Peter": "1pe",
  "2 Peter": "2pe",
  "1 John": "1jn",
  "2 John": "2jn",
  "3 John": "3jn",
  "Jude": "jud",
  "Revelation": "rev",
};

/**
 * BibleHub book name slugs (lowercase, underscores, special cases).
 */
export const BIBLEHUB_SLUGS: Record<string, string> = {
  "Genesis": "genesis",
  "Exodus": "exodus",
  "Leviticus": "leviticus",
  "Numbers": "numbers",
  "Deuteronomy": "deuteronomy",
  "Joshua": "joshua",
  "Judges": "judges",
  "Ruth": "ruth",
  "1 Samuel": "1_samuel",
  "2 Samuel": "2_samuel",
  "1 Kings": "1_kings",
  "2 Kings": "2_kings",
  "1 Chronicles": "1_chronicles",
  "2 Chronicles": "2_chronicles",
  "Ezra": "ezra",
  "Nehemiah": "nehemiah",
  "Esther": "esther",
  "Job": "job",
  "Psalms": "psalms",
  "Proverbs": "proverbs",
  "Ecclesiastes": "ecclesiastes",
  "Song of Solomon": "songs",
  "Isaiah": "isaiah",
  "Jeremiah": "jeremiah",
  "Lamentations": "lamentations",
  "Ezekiel": "ezekiel",
  "Daniel": "daniel",
  "Hosea": "hosea",
  "Joel": "joel",
  "Amos": "amos",
  "Obadiah": "obadiah",
  "Jonah": "jonah",
  "Micah": "micah",
  "Nahum": "nahum",
  "Habakkuk": "habakkuk",
  "Zephaniah": "zephaniah",
  "Haggai": "haggai",
  "Zechariah": "zechariah",
  "Malachi": "malachi",
  "Matthew": "matthew",
  "Mark": "mark",
  "Luke": "luke",
  "John": "john",
  "Acts": "acts",
  "Romans": "romans",
  "1 Corinthians": "1_corinthians",
  "2 Corinthians": "2_corinthians",
  "Galatians": "galatians",
  "Ephesians": "ephesians",
  "Philippians": "philippians",
  "Colossians": "colossians",
  "1 Thessalonians": "1_thessalonians",
  "2 Thessalonians": "2_thessalonians",
  "1 Timothy": "1_timothy",
  "2 Timothy": "2_timothy",
  "Titus": "titus",
  "Philemon": "philemon",
  "Hebrews": "hebrews",
  "James": "james",
  "1 Peter": "1_peter",
  "2 Peter": "2_peter",
  "1 John": "1_john",
  "2 John": "2_john",
  "3 John": "3_john",
  "Jude": "jude",
  "Revelation": "revelation",
};

/**
 * Bible.com (YouVersion) numeric translation IDs.
 */
export const BIBLE_COM_TRANSLATION_IDS: Record<string, number> = {
  "KJV": 1,
  "ESV": 59,
  "NASB": 100,
  "NIV": 111,
  "NKJV": 114,
  "NLT": 116,
  "AMP": 1588,
  "CSB": 1713,
  "MSG": 97,
  "RSV": 2020,
};

/**
 * Curated list of HelloAO Bible translations for the settings dropdown.
 */
export const HELLOAO_TRANSLATIONS: { id: string; name: string; abbreviation: string }[] = [
  { id: "eng_kjv",   name: "King James Version (KJV)",          abbreviation: "KJV" },
  { id: "BSB",       name: "Berean Standard Bible (BSB)",       abbreviation: "BSB" },
  { id: "eng_asv",   name: "American Standard Version (ASV)",   abbreviation: "ASV" },
  { id: "eng_web",   name: "World English Bible (WEB)",         abbreviation: "WEB" },
  { id: "eng_net",   name: "NET Bible (NET)",                   abbreviation: "NET" },
  { id: "eng_dby",   name: "Darby Translation (DARBY)",         abbreviation: "DARBY" },
  { id: "eng_dra",   name: "Douay-Rheims 1899 (DRB)",           abbreviation: "DRB" },
  { id: "eng_rv5",   name: "Revised Version (ERV)",             abbreviation: "ERV" },
  { id: "eng_kja",   name: "King James + Apocrypha (KJV+)",     abbreviation: "KJV+" },
  { id: "eng_wbs",   name: "Webster Bible (WBT)",               abbreviation: "WBT" },
  { id: "eng_ylt",   name: "Young's Literal Translation (YLT)", abbreviation: "YLT" },
  { id: "eng_bbe",   name: "Bible in Basic English (BBE)",      abbreviation: "BBE" },
  { id: "eng_fbv",   name: "Free Bible Version (FBV)",          abbreviation: "FBV" },
  { id: "eng_lsv",   name: "Literal Standard Version (LSV)",    abbreviation: "LSV" },
  { id: "eng_msb",   name: "Majority Standard Bible (MSB)",     abbreviation: "MSB" },
  { id: "ENGWEBP",   name: "World English Bible (WEB-P)",       abbreviation: "WEBP" },
  { id: "eng_gnv",   name: "Geneva Bible 1599 (GNV)",           abbreviation: "GNV" },
  { id: "eng_ojb",   name: "Orthodox Jewish Bible (OJB)",       abbreviation: "OJB" },
];

/**
 * Mapping from HelloAO translation ID → short display abbreviation.
 */
export const HELLOAO_ABBREV: Record<string, string> = Object.fromEntries(
  HELLOAO_TRANSLATIONS.map((t) => [t.id, t.abbreviation])
);

// TODO: Link-only mode for commercially-licensed translations (NIV, NLT, NKJV, AMP, ESV)
// — render just a hyperlink to BibleGateway/BibleHub without fetching text. Future v2 feature.

/**
 * Book name aliases → canonical name.
 * Handles common variations users might type.
 */
export const BOOK_ALIASES: Record<string, string> = {
  // Psalm vs Psalms
  "psalm": "Psalms",
  "psalms": "Psalms",
  "ps": "Psalms",
  "psa": "Psalms",

  // Song of Solomon variations
  "song of solomon": "Song of Solomon",
  "song of songs": "Song of Solomon",
  "songs": "Song of Solomon",
  "sos": "Song of Solomon",
  "sng": "Song of Solomon",
  "song": "Song of Solomon",

  // Genesis
  "genesis": "Genesis",
  "gen": "Genesis",

  // Exodus
  "exodus": "Exodus",
  "exod": "Exodus",
  "exo": "Exodus",
  "ex": "Exodus",

  // Leviticus
  "leviticus": "Leviticus",
  "lev": "Leviticus",

  // Numbers
  "numbers": "Numbers",
  "num": "Numbers",

  // Deuteronomy
  "deuteronomy": "Deuteronomy",
  "deut": "Deuteronomy",
  "deu": "Deuteronomy",
  "dt": "Deuteronomy",

  // Joshua
  "joshua": "Joshua",
  "josh": "Joshua",
  "jos": "Joshua",

  // Judges
  "judges": "Judges",
  "judg": "Judges",
  "jdg": "Judges",

  // Ruth
  "ruth": "Ruth",
  "rut": "Ruth",

  // Samuel
  "1 samuel": "1 Samuel",
  "1samuel": "1 Samuel",
  "1 sam": "1 Samuel",
  "1sam": "1 Samuel",
  "1sa": "1 Samuel",
  "2 samuel": "2 Samuel",
  "2samuel": "2 Samuel",
  "2 sam": "2 Samuel",
  "2sam": "2 Samuel",
  "2sa": "2 Samuel",

  // Kings
  "1 kings": "1 Kings",
  "1kings": "1 Kings",
  "1 kgs": "1 Kings",
  "1kgs": "1 Kings",
  "1ki": "1 Kings",
  "2 kings": "2 Kings",
  "2kings": "2 Kings",
  "2 kgs": "2 Kings",
  "2kgs": "2 Kings",
  "2ki": "2 Kings",

  // Chronicles
  "1 chronicles": "1 Chronicles",
  "1chronicles": "1 Chronicles",
  "1 chr": "1 Chronicles",
  "1chr": "1 Chronicles",
  "1ch": "1 Chronicles",
  "2 chronicles": "2 Chronicles",
  "2chronicles": "2 Chronicles",
  "2 chr": "2 Chronicles",
  "2chr": "2 Chronicles",
  "2ch": "2 Chronicles",

  // Ezra
  "ezra": "Ezra",
  "ezr": "Ezra",

  // Nehemiah
  "nehemiah": "Nehemiah",
  "neh": "Nehemiah",

  // Esther
  "esther": "Esther",
  "est": "Esther",

  // Job
  "job": "Job",

  // Proverbs
  "proverbs": "Proverbs",
  "prov": "Proverbs",
  "pro": "Proverbs",
  "pr": "Proverbs",

  // Ecclesiastes
  "ecclesiastes": "Ecclesiastes",
  "eccl": "Ecclesiastes",
  "ecc": "Ecclesiastes",
  "eccles": "Ecclesiastes",

  // Isaiah
  "isaiah": "Isaiah",
  "isa": "Isaiah",
  "is": "Isaiah",

  // Jeremiah
  "jeremiah": "Jeremiah",
  "jer": "Jeremiah",

  // Lamentations
  "lamentations": "Lamentations",
  "lam": "Lamentations",

  // Ezekiel
  "ezekiel": "Ezekiel",
  "ezek": "Ezekiel",
  "eze": "Ezekiel",
  "ezk": "Ezekiel",

  // Daniel
  "daniel": "Daniel",
  "dan": "Daniel",

  // Hosea
  "hosea": "Hosea",
  "hos": "Hosea",

  // Joel
  "joel": "Joel",
  "joe": "Joel",

  // Amos
  "amos": "Amos",

  // Obadiah
  "obadiah": "Obadiah",
  "oba": "Obadiah",
  "obad": "Obadiah",

  // Jonah
  "jonah": "Jonah",
  "jon": "Jonah",

  // Micah
  "micah": "Micah",
  "mic": "Micah",

  // Nahum
  "nahum": "Nahum",
  "nah": "Nahum",
  "nam": "Nahum",

  // Habakkuk
  "habakkuk": "Habakkuk",
  "hab": "Habakkuk",

  // Zephaniah
  "zephaniah": "Zephaniah",
  "zeph": "Zephaniah",
  "zep": "Zephaniah",

  // Haggai
  "haggai": "Haggai",
  "hag": "Haggai",

  // Zechariah
  "zechariah": "Zechariah",
  "zech": "Zechariah",
  "zec": "Zechariah",

  // Malachi
  "malachi": "Malachi",
  "mal": "Malachi",

  // Matthew
  "matthew": "Matthew",
  "matt": "Matthew",
  "mat": "Matthew",
  "mt": "Matthew",

  // Mark
  "mark": "Mark",
  "mrk": "Mark",
  "mk": "Mark",

  // Luke
  "luke": "Luke",
  "luk": "Luke",
  "lk": "Luke",

  // John (not 1/2/3 John)
  "john": "John",
  "jhn": "John",
  "jn": "John",

  // Acts
  "acts": "Acts",
  "act": "Acts",

  // Romans
  "romans": "Romans",
  "rom": "Romans",
  "ro": "Romans",

  // Corinthians
  "1 corinthians": "1 Corinthians",
  "1corinthians": "1 Corinthians",
  "1 cor": "1 Corinthians",
  "1cor": "1 Corinthians",
  "1co": "1 Corinthians",
  "2 corinthians": "2 Corinthians",
  "2corinthians": "2 Corinthians",
  "2 cor": "2 Corinthians",
  "2cor": "2 Corinthians",
  "2co": "2 Corinthians",

  // Galatians
  "galatians": "Galatians",
  "gal": "Galatians",

  // Ephesians
  "ephesians": "Ephesians",
  "eph": "Ephesians",

  // Philippians
  "philippians": "Philippians",
  "phil": "Philippians",
  "php": "Philippians",

  // Colossians
  "colossians": "Colossians",
  "col": "Colossians",

  // Thessalonians
  "1 thessalonians": "1 Thessalonians",
  "1thessalonians": "1 Thessalonians",
  "1 thess": "1 Thessalonians",
  "1thess": "1 Thessalonians",
  "1th": "1 Thessalonians",
  "2 thessalonians": "2 Thessalonians",
  "2thessalonians": "2 Thessalonians",
  "2 thess": "2 Thessalonians",
  "2thess": "2 Thessalonians",
  "2th": "2 Thessalonians",

  // Timothy
  "1 timothy": "1 Timothy",
  "1timothy": "1 Timothy",
  "1 tim": "1 Timothy",
  "1tim": "1 Timothy",
  "1ti": "1 Timothy",
  "2 timothy": "2 Timothy",
  "2timothy": "2 Timothy",
  "2 tim": "2 Timothy",
  "2tim": "2 Timothy",
  "2ti": "2 Timothy",

  // Titus
  "titus": "Titus",
  "tit": "Titus",

  // Philemon
  "philemon": "Philemon",
  "phm": "Philemon",
  "phlm": "Philemon",

  // Hebrews
  "hebrews": "Hebrews",
  "heb": "Hebrews",

  // James
  "james": "James",
  "jas": "James",

  // Peter
  "1 peter": "1 Peter",
  "1peter": "1 Peter",
  "1 pet": "1 Peter",
  "1pet": "1 Peter",
  "1pe": "1 Peter",
  "2 peter": "2 Peter",
  "2peter": "2 Peter",
  "2 pet": "2 Peter",
  "2pet": "2 Peter",
  "2pe": "2 Peter",

  // John epistles
  "1 john": "1 John",
  "1john": "1 John",
  "1 jn": "1 John",
  "1jn": "1 John",
  "2 john": "2 John",
  "2john": "2 John",
  "2 jn": "2 John",
  "2jn": "2 John",
  "3 john": "3 John",
  "3john": "3 John",
  "3 jn": "3 John",
  "3jn": "3 John",

  // Jude
  "jude": "Jude",
  "jud": "Jude",

  // Revelation
  "revelation": "Revelation",
  "rev": "Revelation",
  "re": "Revelation",
};
