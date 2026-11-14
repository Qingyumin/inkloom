import { validateAppearancePack } from './appearance-pack.mjs';

const make = (id, name, light, dark, css, icons) => validateAppearancePack({
  format: 'inkloom.appearance', version: 1, id, name, author: 'Inkloom', license: 'Inkloom built-in appearance; Lucide ISC and derived Feather MIT licenses', variants: { light, dark }, css, icons,
});

export const appearancePresets = [
  make('inkloom-line', '线稿',
    { base: '#ffffff', secondary: '#f0f2f3', ink: '#22272c', muted: '#596169', accent: '#176b67', readerBg: '#ffffff', readerInk: '#22272c', readerMuted: '#596169', readerAccent: '#176b67', radius: 0, iconSize: 14, controlSize: 28, readerFont: 'sans' },
    { base: '#191c20', secondary: '#22262b', ink: '#f0f3f5', muted: '#b7c0c8', accent: '#6bd7c4', readerBg: '#191c20', readerInk: '#f0f3f5', readerMuted: '#b7c0c8', readerAccent: '#6bd7c4', radius: 0, iconSize: 14, controlSize: 28, readerFont: 'sans' },
    'h1 { font-weight: 500; font-size: 28px; } h2 { font-weight: 600; } blockquote { border-width: 2px; border-style: solid; }',
    { file: 'file-text', folder: 'folder-tree', graph: 'network', database: 'table-2', daily: 'calendar-days' }),
  make('inkloom-editorial', '纸页',
    { base: '#fffefe', secondary: '#f3f0f1', ink: '#30272c', muted: '#66575e', accent: '#ae304f', readerBg: '#fffefe', readerInk: '#30272c', readerMuted: '#66575e', readerAccent: '#ae304f', radius: 4, iconSize: 15, controlSize: 30, readerFont: 'book' },
    { base: '#211c20', secondary: '#2b2429', ink: '#f5edf1', muted: '#cdbbc5', accent: '#ff9cbb', readerBg: '#211c20', readerInk: '#f5edf1', readerMuted: '#cdbbc5', readerAccent: '#ff9cbb', radius: 4, iconSize: 15, controlSize: 30, readerFont: 'book' },
    'h1 { font-weight: 600; font-size: 32px; } h2 { margin-top: 2em; } blockquote { font-style: italic; padding-left: 16px; border-width: 2px; border-style: solid; }',
    { file: 'book-open', folder: 'library', graph: 'waypoints', database: 'columns-3', daily: 'notebook-pen' }),
  make('inkloom-canopy', '林间',
    { base: '#f9fcfa', secondary: '#edf4ef', ink: '#203d33', muted: '#50695e', accent: '#237455', readerBg: '#ffffff', readerInk: '#203d33', readerMuted: '#50695e', readerAccent: '#237455', radius: 7, iconSize: 16, controlSize: 32, readerFont: 'sans' },
    { base: '#17231e', secondary: '#203028', ink: '#ecf6f0', muted: '#b5c9bd', accent: '#8bd8ac', readerBg: '#17231e', readerInk: '#ecf6f0', readerMuted: '#b5c9bd', readerAccent: '#8bd8ac', radius: 7, iconSize: 16, controlSize: 32, readerFont: 'sans' },
    'h1 { font-weight: 700; font-size: 30px; } blockquote { border-radius: 6px; padding: 16px; } table { border-radius: 6px; }',
    { file: 'leaf', folder: 'folder-open', graph: 'orbit', database: 'layout-grid', daily: 'sunrise' }),
];