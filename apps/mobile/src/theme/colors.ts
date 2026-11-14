export const colors = {
  // Core Wealth Atlas mockup tokens
  navy: '#26333c',
  navyPressed: '#1b252c',
  rust: '#a94731',
  rustPressed: '#903a29',
  cream: '#f8f2e9',
  card: '#fffaf3',
  sand: '#e9e1d6',
  ink: '#26333c',
  muted: '#62665f',
  line: '#dfd5c8',
  controlLine: '#8d8172',
  peach: '#efb397',

  // Hero card tokens (.hero)
  heroText: '#fffaf3',
  heroSubtle: '#e4d8cb',
  heroMuted: '#d3c9be',
  heroAccent: '#f6ccb8',
  heroDivider: '#536069',

  // Callout & selection surfaces (.workspace-callout, .preset-option)
  calloutBg: '#eee3d5',
  calloutBorder: '#d5c3ad',
  selectedBg: '#f4e7dc',

  // Icon tiles (.tile, .tile.rust, .tile.navy)
  tileWarmBg: '#ece2d5',
  tileWarmFg: '#745542',
  tileRustBg: '#f0dfd3',
  tileRustFg: '#a94731',
  tileNavyBg: '#dfe5e6',
  tileNavyFg: '#26333c',

  // Semantic notice & badge tokens (.notice.*, .badge.*)
  noticeBg: '#eee5d8',
  noticeFg: '#5f5345',
  good: '#315c49',
  goodBg: '#e9eee4',
  warn: '#77500f',
  warnBg: '#f5e8ca',
  danger: '#9c352a',
  dangerPressed: '#822b21',
  dangerBg: '#fae8e1',
  badgeNeutralBg: '#ece5d9',
  badgeNeutralFg: '#625b50',
} as const;

export const radii = {
  hero: 22,
  card: 18,
  list: 17,
  option: 16,
  symbol: 15,
  control: 12,
  input: 11,
  tile: 11,
  badge: 6,
} as const;
