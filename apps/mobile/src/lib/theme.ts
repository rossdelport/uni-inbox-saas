// One place for the app's palette. OneInbox uses the same bright, navy-and-blue
// surfaces as the web dashboard so the native companion feels like the same
// product even when the phone itself is set to dark mode.

export interface Theme {
  bg: string;
  card: string;
  text: string;
  sub: string;
  faint: string;
  line: string;
  accent: string;
  accentSoft: string;
  danger: string;
  star: string;
  chipBg: string;
  chipActiveBg: string;
  chipActiveText: string;
  dark: boolean;
}

const light: Theme = {
  bg: "#F2F6FB",
  card: "#FFFFFF",
  text: "#0A2540",
  sub: "#526581",
  faint: "#8294AE",
  line: "#DFE7F1",
  accent: "#0C7DFF",
  accentSoft: "#E7F1FF",
  danger: "#D92D20",
  star: "#F5A623",
  chipBg: "#F4F7FB",
  chipActiveBg: "#E7F1FF",
  chipActiveText: "#0B6FE6",
  dark: false,
};

const dark: Theme = {
  bg: "#0B0C0E",
  card: "#151719",
  text: "#F2F4F7",
  sub: "#98A2B3",
  faint: "#667085",
  line: "#24262B",
  accent: "#4C9AFF",
  accentSoft: "#4C9AFF1F",
  danger: "#F97066",
  star: "#F5A623",
  chipBg: "#1E2126",
  chipActiveBg: "#F2F4F7",
  chipActiveText: "#0B0C0E",
  dark: true,
};

export function useTheme(): Theme {
  // The web product is intentionally light and mail HTML is authored for a
  // light canvas. Keep the app consistent instead of letting a device-wide
  // dark-mode preference turn the companion into a different product.
  return light;
}
