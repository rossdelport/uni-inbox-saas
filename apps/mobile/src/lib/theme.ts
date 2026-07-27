import { useColorScheme } from "react-native";

// One place for the app's palette, light and dark. The dashboard look:
// calm neutrals, one blue accent, hairline separators, no heavy chrome.

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
  bg: "#F6F7F9",
  card: "#FFFFFF",
  text: "#0A2540",
  sub: "#5B6B7B",
  faint: "#93A0AD",
  line: "#E8EBEF",
  accent: "#0B6FE6",
  accentSoft: "#0B6FE614",
  danger: "#D92D20",
  star: "#F5A623",
  chipBg: "#EDF0F3",
  chipActiveBg: "#0A2540",
  chipActiveText: "#FFFFFF",
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
  return useColorScheme() === "dark" ? dark : light;
}
