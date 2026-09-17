export interface SearchMatch {
  /** Detik ke berapa dalam video (bukan format mm:ss) */
  timestamp: number;
  /** Cuplikan teks transcript di sekitar timestamp tersebut */
  text: string;
}

export interface VideoSearchResult {
  videoId: string;
  title: string;
  matches: SearchMatch[];
}
