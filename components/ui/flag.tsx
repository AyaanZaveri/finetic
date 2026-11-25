import React from "react";

interface FlagProps {
  language: string;
  className?: string;
  size?: number;
}

// Map language codes to country codes for flag display
const languageToCountryMap: Record<string, string> = {
  en: "us", // English -> United States
  "en-us": "us",
  "en-gb": "gb",
  es: "es", // Spanish -> Spain
  "es-mx": "mx",
  "es-ar": "ar",
  fr: "fr", // French -> France
  de: "de", // German -> Germany
  it: "it", // Italian -> Italy
  pt: "pt", // Portuguese -> Portugal
  "pt-br": "br",
  ru: "ru", // Russian -> Russia
  ja: "jp", // Japanese -> Japan
  ko: "kr", // Korean -> South Korea
  zh: "cn", // Chinese -> China
  "zh-cn": "cn",
  "zh-tw": "tw",
  ar: "sa", // Arabic -> Saudi Arabia
  hi: "in", // Hindi -> India
  nl: "nl", // Dutch -> Netherlands
  sv: "se", // Swedish -> Sweden
  no: "no", // Norwegian -> Norway
  da: "dk", // Danish -> Denmark
  fi: "fi", // Finnish -> Finland
  pl: "pl", // Polish -> Poland
  tr: "tr", // Turkish -> Turkey
  th: "th", // Thai -> Thailand
  vi: "vn", // Vietnamese -> Vietnam
  he: "il", // Hebrew -> Israel
  cs: "cz", // Czech -> Czech Republic
  hu: "hu", // Hungarian -> Hungary
  ro: "ro", // Romanian -> Romania
  bg: "bg", // Bulgarian -> Bulgaria
  hr: "hr", // Croatian -> Croatia
  sk: "sk", // Slovak -> Slovakia
  sl: "si", // Slovenian -> Slovenia
  et: "ee", // Estonian -> Estonia
  lv: "lv", // Latvian -> Latvia
  lt: "lt", // Lithuanian -> Lithuania
  uk: "ua", // Ukrainian -> Ukraine
  be: "by", // Belarusian -> Belarus
  mk: "mk", // Macedonian -> North Macedonia
  sq: "al", // Albanian -> Albania
  sr: "rs", // Serbian -> Serbia
  bs: "ba", // Bosnian -> Bosnia and Herzegovina
  mt: "mt", // Maltese -> Malta
  is: "is", // Icelandic -> Iceland
  ga: "ie", // Irish -> Ireland
  cy: "gb", // Welsh -> Great Britain
  eu: "es", // Basque -> Spain
  ca: "es", // Catalan -> Spain
  gl: "es", // Galician -> Spain
};

export function Flag({ language, className = "", size = 16 }: FlagProps) {
  if (!language || language === "null") {
    return (
      <div
        className={`inline-block bg-gray-300 rounded-sm ${className}`}
        style={{ width: size, height: size * 0.75 }}
        title="No language"
      />
    );
  }

  const normalizedLanguage = language.toLowerCase();
  const countryCode = languageToCountryMap[normalizedLanguage] || normalizedLanguage.slice(0, 2);

  return (
    <img
      draggable={false}
      src={`https://flagsapi.com/${countryCode.toUpperCase()}/flat/32.png`}
      alt={`${language} flag`}
      className={`inline-block rounded-sm ${className}`}
      style={{ width: size, height: size * 0.75 }}
      title={language.toUpperCase()}
      onError={(e) => {
        // Fallback to a generic flag if the specific flag fails to load
        const target = e.target as HTMLImageElement;
        target.src = `https://flagsapi.com/UN/flat/32.png`; // UN flag as fallback
      }}
    />
  );
}
