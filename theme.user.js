// ==UserScript==
// @name         Crack Scene Painter - Generated Image Background Blur 🖼️
// @namespace    crack-scene-painter-background-borderless
// @version      2.0.0
// @description  오른쪽 메뉴의 "배경 이미지 보기" 글씨를 눌러 배경/테마 설정을 열고, CSP 모드에서는 삽화 확프로 생성한 이미지를 자동으로 현재 방 배경에 적용합니다.
// @match        https://crack.wrtn.ai/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_NAME = 'CSP Borderless Background Blur';
  const VERSION = '2.0.0';

  /**
   * 값 조절은 여기만 보면 됨.
   * - blurPx 낮을수록 배경 그림이 선명함.
   * - imageOpacity 높을수록 그림이 진함.
   * - dim 높을수록 어두운 막이 강함.
   */
  const CONFIG = {
    enabled: true,
    darkModeOnly: true,

    blurPx: 6,
    imageOpacity: 0.64,
    scale: 1.00,
    dim: 0.34,
    saturate: 1.05,
    brightness: 0.82,
    objectFit: 'contain',
    objectPosition: 'center center',

    uiOpacity: 0.86,
    chatBubbleOpacityLight: 0.34,
    chatBubbleOpacityDark: 0.30,
    inputBottomPaddingPx: 16,

    transparentLargePanels: false,
    syncIntervalMs: 5000,
    imageDetectMarginPx: 220,
    refreshAfterClickMs: [80, 260, 700, 1400],

    // 에리 로어 인젝터 호환:
    // 시작/SPA 이동 시 에리 메뉴 버튼이 먼저 붙을 시간을 주되, 무한 대기는 하지 않는다.
    eriCompatibilityEnabled: true,
    eriDetectGraceMs: 1800,
    eriBootPollMs: 120,
    eriBootMaxWaitMs: 3600,
    eriRouteHoldMs: 3200,

    debug: false
  };

  const DEFAULT_BACKGROUND_SETTINGS = Object.freeze({
    enabled: true,
    blurPx: 6,
    imageOpacity: 0.64,
    scale: 1.00,
    dim: 0.34,
    saturate: 1.05,
    brightness: 0.82,
    uiOpacity: 0.86,
    themeRecommendedColorsEnabled: true,
    uiPaletteIndex: 0,
    customColorBackup: null,
    markdownDecorEnabled: true,

    textColor: '#fafafa',
    emColor: '#85837d',
    strongColor: '#fafafa',
    italicTextColor: '#84827e',
    strongBgTextColor: '#fafafa',
    textShadowEnabled: true,
    textShadowTone: 'dark',
    chatFont: 'none',
    customFontCssUrl: '',
    customFontFamily: '',
    customFontSourceInput: '',
    customFontLocalId: '',
    textScale: 1.00,
    codeTextScale: 1.00,
    fontWeight: 400,
    lineHeight: 1.65,
    letterSpacing: 0,
    paragraphSpacing: 0.70,

    dialogueBgEnabled: true,
    thoughtBgEnabled: true,
    italicBgEnabled: true,
    strongBgEnabled: true,
    codeBlockBgEnabled: true,

    dialogueBg: '#b29aa6',
    dialogueTextColor: '#fdfbfc',
    thoughtBg: '#a89aa6',
    thoughtTextColor: '#f4eef1',
    italicBg: '#e8e0e4',
    strongBg: '#f0e0e8',
    codeAccent: '#c8a6b6',

    highlightShape: 'highlight',
    uiStyle: 'borderless'
  });

  function getDefaultBackgroundSettings() {
    return { ...DEFAULT_BACKGROUND_SETTINGS };
  }

  const CSP_PREFIX = 'csp_scene_painter';
  const IMAGE_DB_NAME = `${CSP_PREFIX}_image_db`;
  const IMAGE_STORE_NAME = 'images';
  const SGB_SETTINGS_KEY = 'sgb_background_settings_borderless_v1';
  const SGB_SETTINGS_BACKUP_KEY = `${SGB_SETTINGS_KEY}_backup`;
  const SGB_SETTINGS_COOKIE = `${SGB_SETTINGS_KEY}_cookie`;
  const SGB_FONT_DRAFT_KEY = `${SGB_SETTINGS_KEY}_font_draft_v1`;
  const SGB_FONT_LIBRARY_KEY = `${SGB_SETTINGS_KEY}_font_library_v1`;
  const SGB_FONT_DB_NAME = 'sgb_custom_font_db_v1';
  const SGB_FONT_DB_VERSION = 1;
  const SGB_FONT_STORE_NAME = 'fonts';
  const SGB_UI_IDS = {
    row: 'sgb-bg-settings-row',
    modal: 'sgb-bg-settings-modal'
  };

  const IDS = {
    root: 'sgb-bg-root',
    bg: 'sgb-bg-img',
    dim: 'sgb-bg-dim',
    style: 'sgb-bg-style'
  };

  const CLS_ROOM = 'sgb-bg-room';
  const CLS_ACTIVE = 'sgb-bg-active';
  const CLS_IMAGE_ACTIVE = 'sgb-bg-image-active';


  // 강조 배경 감지.
  // 대사: "...", 「...」, ❝...❞
  // 생각: '...'
  const DOUBLE_OPEN = new Set(['"', '「', '❝']);
  const DOUBLE_CLOSE = new Set(['"', '」', '❞']);
  const SINGLE_OPEN = new Set(["'"]);
  const SINGLE_CLOSE = new Set(["'"]);
  const QUOTE_CHAR_RE = /["'「」❝❞]/;

  const state = {
    roomId: '',
    path: location.pathname,
    currentSrc: '',
    currentSignature: '',
    refreshTimer: 0,
    settingsAdjustTimer: 0,
    colorApplyTimer: 0,
    fontApplyTimer: 0,
    decorateTimer: 0,
    settingsDecorateTimer: 0,
    quoteHealTimer: 0,
    quoteHealUntil: 0,
    quoteWrapSeq: 0,
    quoteWraps: new Map(),
    observer: null,
    themeObserver: null,
    intervalId: 0,
    dbPromise: null,
    routeHoldUntil: 0,
    routeHoldTimer: 0,
    routeWatchInstalled: false,
    volatileSettings: {},
    lastCommittedSettingsText: '',
    fontResolveSource: '',
    fontResolveStatus: 'idle',
    resolvedCustomFontCss: '',
    resolvedCustomFontFamily: '',
    resolvedCustomFontFamilies: [],
    fontDbPromise: null,
    localFontRuntime: new Map(),
    localFontLoadId: '',
    localFontLoadStatus: 'idle'
  };

  if (window.__SGB_BACKGROUND_LAYER_0950_BORDERLESS_LOADED__ || window.__SGB_BACKGROUND_LAYER_0949_DIALOGUE_BRACKETS_QUOTES_LOADED__) return;
  window.__SGB_BACKGROUND_LAYER_0950_BORDERLESS_LOADED__ = true;
  window.__SGB_BACKGROUND_LAYER_0949_DIALOGUE_BRACKETS_QUOTES_LOADED__ = true;

  function log(...args) {
    if (CONFIG.debug) console.log(`[${SCRIPT_NAME}]`, ...args);
  }

  function safeJsonParse(value, fallback = {}) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function clampValue(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeHexColor(value, fallback) {
    const raw = String(value || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();

    const short = raw.match(/^#([0-9a-fA-F]{3})$/);
    if (short) {
      return `#${short[1].split('').map(ch => ch + ch).join('')}`.toLowerCase();
    }

    return fallback;
  }


  function hexToRgbTriplet(hex, fallback = '255,255,255') {
    const value = normalizeHexColor(hex, null);
    if (!value) return fallback;
    const r = parseInt(value.slice(1, 3), 16);
    const g = parseInt(value.slice(3, 5), 16);
    const b = parseInt(value.slice(5, 7), 16);
    return `${r},${g},${b}`;
  }

  function normalizeHighlightShape(value, fallback = 'highlight') {
    // v1.2.2: 둥근 사각/각진 사각 선택은 제거하고 형광펜형만 유지한다.
    return 'highlight';
  }

  function getHighlightShapeDefinitions() {
    return [
      { value: 'highlight', label: '형광펜', icon: '▬' }
    ];
  }


  function normalizeUiStyle(value, fallback = 'borderless') {
    const raw = String(value || '').trim().toLowerCase();
    // 기존 Ink 저장값은 Normal로 자동 이관한다.
    if (raw === 'ink') return 'normal';
    const allowed = new Set(['normal', 'borderless', 'glass', 'pixel', 'sticker', 'candy', 'cozy', 'codepad', 'najeon', 'starjar', 'newsprint', 'jazzbar']);
    return allowed.has(raw) ? raw : fallback;
  }

  function getUiStyleDefinitions() {
    return [
      { value: 'normal', label: 'Normal', desc: '배경 유지 순정 UI' },
      { value: 'borderless', label: 'Borderless', desc: '말풍선 무테 UI' },
      { value: 'glass', label: 'Glass', desc: '기존 글라스' },
      { value: 'pixel', label: 'Pixel', desc: '연한 픽셀 UI' },
      { value: 'sticker', label: 'Sticker', desc: '말랑 스티커 UI' },
      { value: 'candy', label: 'Candy', desc: '젤리 캔디 토이 UI' },
      { value: 'cozy', label: 'Cozy', desc: '테이프 메모 카드' },
      { value: 'codepad', label: 'Stone', desc: '맥 창 · 뮤트 스톤' },
      { value: 'najeon', label: 'Najeon', desc: '자개 옻칠' },
      { value: 'starjar', label: 'Starjar', desc: '별 담은 유리병' },
      { value: 'newsprint', label: 'Newsprint', desc: '신문 활자' },
      { value: 'jazzbar', label: 'Jazzbar', desc: '벨벳 재즈바' }
    ];
  }

  function getUiStylePaletteDefinitions(value) {
    const basePatch = { themeRecommendedColorsEnabled: true };
    const baseThemePatches = {
      normal: { textColor:'#fafafa', emColor:'#85837d', strongColor:'#fafafa', italicTextColor:'#84827e', strongBgTextColor:'#fafafa', dialogueBg:'#b29aa6', dialogueTextColor:'#fdfbfc', thoughtBg:'#a89aa6', thoughtTextColor:'#f4eef1', italicBg:'#e8e0e4', strongBg:'#f0e0e8', codeAccent:'#c8a6b6' },
      borderless: { textColor:'#fafafa', emColor:'#a6a5a7', strongColor:'#ffffff', italicTextColor:'#c4c1ca', strongBgTextColor:'#fff8ff', dialogueBg:'#b9a5b4', dialogueTextColor:'#fdfbfc', thoughtBg:'#aca2b6', thoughtTextColor:'#f5eff3', italicBg:'#e1dae2', strongBg:'#eee0ea', codeAccent:'#c8aabc' },
      glass: { textColor:'#f2f6ff', emColor:'#a4a6ab', strongColor:'#ffffff', italicTextColor:'#c7ceda', strongBgTextColor:'#f7fcff', dialogueBg:'#96b4eb', dialogueTextColor:'#eef4ff', thoughtBg:'#96a5cd', thoughtTextColor:'#f2f5ff', italicBg:'#afbee1', strongBg:'#c8d7ff', codeAccent:'#96b2e4' },
      pixel: { textColor:'#ecf6ff', emColor:'#9fa2a9', strongColor:'#ffffff', italicTextColor:'#c4cbd6', strongBgTextColor:'#f7fff0', dialogueBg:'#78d7e1', dialogueTextColor:'#eafcff', thoughtBg:'#7d9bd7', thoughtTextColor:'#eef5ff', italicBg:'#78aacd', strongBg:'#82dce6', codeAccent:'#6eb9d4' },
      sticker: { textColor:'#f7f6ff', emColor:'#b0afb5', strongColor:'#ffffff', italicTextColor:'#d0c8cf', strongBgTextColor:'#fff7fb', dialogueBg:'#ffbed6', dialogueTextColor:'#fff2f7', thoughtBg:'#bcdeff', thoughtTextColor:'#eef6ff', italicBg:'#ffe0a5', strongBg:'#ffc4dc', codeAccent:'#bee0ff' },
      candy: { textColor:'#fcfcff', emColor:'#b6b5bb', strongColor:'#ffffff', italicTextColor:'#d2cfd8', strongBgTextColor:'#fff8fc', dialogueBg:'#ffb9ca', dialogueTextColor:'#fff1f6', thoughtBg:'#b2deff', thoughtTextColor:'#eef6ff', italicBg:'#ffe4a8', strongBg:'#ffbece', codeAccent:'#b6e0ff' },
      cozy: { textColor:'#4F3E2A', emColor:'#7A5C39', strongColor:'#332416', italicTextColor:'#7A5C39', strongBgTextColor:'#332416', dialogueBg:'#ddb867', dialogueTextColor:'#412B0F', thoughtBg:'#d8c6a9', thoughtTextColor:'#58452E', italicBg:'#d8c6a9', strongBg:'#ddb867', codeAccent:'#d7cab2' },
      codepad: { textColor:'#eee9e0', emColor:'#b5afa2', strongColor:'#f9f5ee', italicTextColor:'#b5afa2', strongBgTextColor:'#f9f5ee', dialogueBg:'#d0a68c', dialogueTextColor:'#e6b79c', thoughtBg:'#bec496', thoughtTextColor:'#cbd0a2', italicBg:'#bec496', strongBg:'#d0a68c', codeAccent:'#969284' },
      najeon: { textColor:'#efeaf3', emColor:'#c2bbd4', strongColor:'#ffffff', italicTextColor:'#c2bbd4', strongBgTextColor:'#ffffff', dialogueBg:'#96cdeb', dialogueTextColor:'#eef7ff', thoughtBg:'#c8aaeb', thoughtTextColor:'#f4eeff', italicBg:'#af8ce1', strongBg:'#8ccdeb', codeAccent:'#82afe4' },
      starjar: { textColor:'#f0eede', emColor:'#c8bd9c', strongColor:'#fff6e2', italicTextColor:'#d7cda9', strongBgTextColor:'#fff6e2', dialogueBg:'#f0cf7e', dialogueTextColor:'#ffe8aa', thoughtBg:'#968ec4', thoughtTextColor:'#ece4d0', italicBg:'#c8bd9c', strongBg:'#ffdc8c', codeAccent:'#d6b478' },
      newsprint: { textColor:'#221f19', emColor:'#5a544a', strongColor:'#000000', italicTextColor:'#5a544a', strongBgTextColor:'#000000', dialogueBg:'#4a4438', dialogueTextColor:'#221f19', thoughtBg:'#969082', thoughtTextColor:'#4a4438', italicBg:'#cdc5b3', strongBg:'#968c78', codeAccent:'#968c78' },
      jazzbar: { textColor:'#f0dcc8', emColor:'#c8966a', strongColor:'#e8c888', italicTextColor:'#c8966a', strongBgTextColor:'#e8c888', dialogueBg:'#c8965a', dialogueTextColor:'#f0d8b0', thoughtBg:'#966e50', thoughtTextColor:'#e0c0a0', italicBg:'#c8966a', strongBg:'#e8c888', codeAccent:'#c8a45a' }
    };
    const preset = (label, colors, patch) => ({ label, colors, patch: { themeRecommendedColorsEnabled: true, ...patch } });
    const base = (label, colors) => {
      const style = normalizeUiStyle(value);
      return { label, colors, patch: { ...basePatch, ...(baseThemePatches[style] || {}) } };
    };

    switch (normalizeUiStyle(value)) {
      case 'normal':
        return [
          base('기준', ['#fafafa', '#85837d', '#c8a6b6'])
        ];
      case 'borderless':
        return [
          base('기준', ['#fafafa', '#b9a5b4', '#aca2b6']),
          preset('라벤더', ['#f7f1ff', '#c7a8e8', '#aeb8e8'], { textColor:'#f7f1ff', emColor:'#aca8b1', strongColor:'#ffffff', dialogueBg:'#c7a8e8', dialogueTextColor:'#fff8ff', thoughtBg:'#aeb8e8', thoughtTextColor:'#f6f7ff', italicBg:'#d7c9eb', italicTextColor:'#d0c9d9', strongBg:'#c7a8e8', strongBgTextColor:'#fff8ff', codeAccent:'#bca9df' }),
          preset('민트블루', ['#f0ffff', '#8ed8d2', '#9bbdea'], { textColor:'#f0ffff', emColor:'#a3a9a8', strongColor:'#ffffff', dialogueBg:'#8ed8d2', dialogueTextColor:'#efffff', thoughtBg:'#9bbdea', thoughtTextColor:'#f2f7ff', italicBg:'#b6ddd8', italicTextColor:'#c9dcda', strongBg:'#8ed8d2', strongBgTextColor:'#f3ffff', codeAccent:'#9bbdea' }),
          preset('로즈그레이', ['#fff4f8', '#d6a7b8', '#b8a9c8'], { textColor:'#fff4f8', emColor:'#b0a6a9', strongColor:'#ffffff', dialogueBg:'#d6a7b8', dialogueTextColor:'#fff7fa', thoughtBg:'#b8a9c8', thoughtTextColor:'#faf5ff', italicBg:'#e0c8d0', italicTextColor:'#d7c5cc', strongBg:'#d6a7b8', strongBgTextColor:'#fff7fa', codeAccent:'#c8a6b6' })
        ];
      case 'glass':
        return [
          base('기준', ['#f2f6ff', '#96b4eb', '#96a5cd']),
          preset('아이스', ['#f4fbff', '#93d5ff', '#a6c7ff'], { textColor:'#f4fbff', emColor:'#a7adb4', strongColor:'#ffffff', dialogueBg:'#93d5ff', dialogueTextColor:'#f7fcff', thoughtBg:'#a6c7ff', thoughtTextColor:'#f3f7ff', italicBg:'#bcd8ef', italicTextColor:'#cdd9e6', strongBg:'#93d5ff', strongBgTextColor:'#f7fcff', codeAccent:'#9ec8ee' }),
          preset('오로라', ['#f3fff8', '#8be8ca', '#b7a3ff'], { textColor:'#f3fff8', emColor:'#a7b0ac', strongColor:'#ffffff', dialogueBg:'#8be8ca', dialogueTextColor:'#f2fff9', thoughtBg:'#b7a3ff', thoughtTextColor:'#f9f6ff', italicBg:'#a9dfd0', italicTextColor:'#c7dcd6', strongBg:'#b7a3ff', strongBgTextColor:'#f9f6ff', codeAccent:'#9bd7e0' }),
          preset('스모크', ['#eceff6', '#9ca8bd', '#c0a7d8'], { textColor:'#eceff6', emColor:'#a2a4a9', strongColor:'#ffffff', dialogueBg:'#9ca8bd', dialogueTextColor:'#f4f6fb', thoughtBg:'#c0a7d8', thoughtTextColor:'#fbf5ff', italicBg:'#bfc5d2', italicTextColor:'#cacdd4', strongBg:'#c0a7d8', strongBgTextColor:'#fbf5ff', codeAccent:'#aeb7c8' })
        ];
      case 'pixel':
        return [
          base('기준', ['#ecf6ff', '#78d7e1', '#7d9bd7']),
          preset('선셋', ['#fff2e6', '#ff6a3d', '#ffca3d'], { textColor:'#fff2e6', emColor:'#bda994', strongColor:'#ffffff', dialogueBg:'#ff6a3d', dialogueTextColor:'#fff0e8', thoughtBg:'#ffca3d', thoughtTextColor:'#fff6e0', italicBg:'#ffc39a', italicTextColor:'#e8c3ab', strongBg:'#ff6a3d', strongBgTextColor:'#fff0e8', codeAccent:'#ffb84d' }),
          preset('핑크8bit', ['#fff1fa', '#ff9fd2', '#91c8ff'], { textColor:'#fff1fa', emColor:'#b2a4aa', strongColor:'#ffffff', dialogueBg:'#ff9fd2', dialogueTextColor:'#fff4fb', thoughtBg:'#91c8ff', thoughtTextColor:'#f3f9ff', italicBg:'#e6bfd3', italicTextColor:'#dac5cf', strongBg:'#ff9fd2', strongBgTextColor:'#fff4fb', codeAccent:'#91c8ff' }),
          preset('게임보이', ['#efffd8', '#9bd86d', '#6fa878'], { textColor:'#efffd8', emColor:'#a3a79a', strongColor:'#ffffff', dialogueBg:'#9bd86d', dialogueTextColor:'#f7ffe8', thoughtBg:'#6fa878', thoughtTextColor:'#f1fff0', italicBg:'#bfd2a8', italicTextColor:'#c6d1b8', strongBg:'#9bd86d', strongBgTextColor:'#f7ffe8', codeAccent:'#8fc274' })
        ];
      case 'sticker':
        return [
          base('기준', ['#f7f6ff', '#ffbed6', '#bcdfff']),
          preset('딸기우유', ['#fff5fa', '#ff9fbd', '#ffd1dd'], { textColor:'#fff5fa', emColor:'#baaaae', strongColor:'#ffffff', dialogueBg:'#ff9fbd', dialogueTextColor:'#fff6fa', thoughtBg:'#ffd1dd', thoughtTextColor:'#fff8fb', italicBg:'#ffb0cc', italicTextColor:'#eccdd9', strongBg:'#ff9fbd', strongBgTextColor:'#fff6fa', codeAccent:'#ffc0d0' }),
          preset('소다', ['#f4fdff', '#8edfff', '#b6d2ff'], { textColor:'#f4fdff', emColor:'#abb5b8', strongColor:'#ffffff', dialogueBg:'#8edfff', dialogueTextColor:'#f3fdff', thoughtBg:'#b6d2ff', thoughtTextColor:'#f5f9ff', italicBg:'#9fd6f2', italicTextColor:'#cfe1ee', strongBg:'#8edfff', strongBgTextColor:'#f3fdff', codeAccent:'#b6d2ff' }),
          preset('레몬크림', ['#fffceb', '#ffe28b', '#b8e0b0'], { textColor:'#fffceb', emColor:'#b8b4a2', strongColor:'#ffffff', dialogueBg:'#ffe28b', dialogueTextColor:'#fff9df', thoughtBg:'#b8e0b0', thoughtTextColor:'#f6fff2', italicBg:'#ffe28b', italicTextColor:'#dfd5b0', strongBg:'#ffd0a0', strongBgTextColor:'#fff9df', codeAccent:'#b8e0b0' })
        ];
      case 'candy':
        return [
          base('기준', ['#fcfcff', '#ffb9ca', '#b2deff']),
          preset('민트캔디', ['#f6fff9', '#80e0c0', '#ffd18c'], { textColor:'#f6fff9', emColor:'#acb5b0', strongColor:'#ffffff', dialogueBg:'#80e0c0', dialogueTextColor:'#f2fff9', thoughtBg:'#ffd18c', thoughtTextColor:'#fff7e8', italicBg:'#c7e1d3', italicTextColor:'#cbdbd2', strongBg:'#ffd18c', strongBgTextColor:'#f2fff9', codeAccent:'#80c8e0' }),
          preset('레몬캔디', ['#fffdec', '#ffcf3d', '#b6e05a'], { textColor:'#fffdec', emColor:'#b9b39f', strongColor:'#ffffff', dialogueBg:'#ffcf3d', dialogueTextColor:'#fff4cf', thoughtBg:'#b6e05a', thoughtTextColor:'#f6ffe4', italicBg:'#ffd6a3', italicTextColor:'#e3d2b6', strongBg:'#ffcf3d', strongBgTextColor:'#fff4cf', codeAccent:'#e0c04d' })
        ];
      case 'cozy':
        return [
          base('기준', ['#4f3a2c', '#c97f55', '#aa966e'])
        ];
      case 'codepad':
        return [
          base('기준', ['#eee9e0', '#d0a68c', '#bec496']),
          preset('Porcelain Blue', ['#eaecf0', '#b6cdec', '#c8bce0'], { textColor:'#eaecf0', emColor:'#adb2ba', strongColor:'#f8fafd', italicTextColor:'#adb2ba', strongBgTextColor:'#f8fafd', dialogueBg:'#b6cdec', dialogueTextColor:'#b6cdec', thoughtBg:'#c8bce0', thoughtTextColor:'#c8bce0', italicBg:'#adb2ba', strongBg:'#b6cdec', codeAccent:'#b6cdec' }),
          preset('Sage · Honey', ['#ecebe2', '#e8cf9e', '#c4d0b2'], { textColor:'#ecebe2', emColor:'#b2b3a6', strongColor:'#f8f6ee', italicTextColor:'#b2b3a6', strongBgTextColor:'#f8f6ee', dialogueBg:'#e8cf9e', dialogueTextColor:'#e8cf9e', thoughtBg:'#c4d0b2', thoughtTextColor:'#c4d0b2', italicBg:'#b2b3a6', strongBg:'#e8cf9e', codeAccent:'#e8cf9e' }),
          preset('Teal · Rose', ['#eceae4', '#a8ccc2', '#dcb6bf'], { textColor:'#eceae4', emColor:'#b0b1ab', strongColor:'#f7f6f1', italicTextColor:'#b0b1ab', strongBgTextColor:'#f7f6f1', dialogueBg:'#a8ccc2', dialogueTextColor:'#a8ccc2', thoughtBg:'#dcb6bf', thoughtTextColor:'#dcb6bf', italicBg:'#b0b1ab', strongBg:'#a8ccc2', codeAccent:'#a8ccc2' })
        ];
      case 'najeon':
        return [
          base('기준', ['#efeaf3', '#96cdeb', '#c8aaeb'])
        ];
      case 'starjar':
        return [
          base('기준', ['#f0eede', '#f0cf7e', '#968ec4'])
        ];
      case 'newsprint':
        return [
          preset('기준', ['#221f19', '#5a544a', '#968c78'], { textColor:'#221f19', emColor:'#5a544a', strongColor:'#000000', dialogueBg:'#4a4438', dialogueTextColor:'#221f19', thoughtBg:'#969082', thoughtTextColor:'#4a4438', italicBg:'#cdc5b3', italicTextColor:'#5a544a', strongBg:'#968c78', strongBgTextColor:'#000000', codeAccent:'#968c78' })
        ];
      case 'jazzbar':
        return [
          base('기준', ['#f0dcc8', '#c8966a', '#e8c888']),
          preset('블루재즈', ['#dce8ff', '#7fa0d8', '#d8b06a'], { textColor:'#dce8ff', emColor:'#aebbd0', strongColor:'#ffffff', dialogueBg:'#7fa0d8', dialogueTextColor:'#f1f6ff', thoughtBg:'#d8b06a', thoughtTextColor:'#fff4dc', italicBg:'#aebbd0', italicTextColor:'#aebbd0', strongBg:'#d8b06a', strongBgTextColor:'#ffffff', codeAccent:'#7fa0d8' }),
          preset('스모키골드', ['#efe3d4', '#b8975f', '#8a6a58'], { textColor:'#efe3d4', emColor:'#c3a98f', strongColor:'#fff4e5', dialogueBg:'#b8975f', dialogueTextColor:'#fff0d0', thoughtBg:'#8a6a58', thoughtTextColor:'#f1dfd2', italicBg:'#c3a98f', italicTextColor:'#c3a98f', strongBg:'#b8975f', strongBgTextColor:'#fff4e5', codeAccent:'#8a6a58' }),
          preset('와인로즈', ['#ffe6e6', '#d47c91', '#e0b06a'], { textColor:'#ffe6e6', emColor:'#d2a9a9', strongColor:'#ffffff', dialogueBg:'#d47c91', dialogueTextColor:'#fff4f4', thoughtBg:'#e0b06a', thoughtTextColor:'#fff4dc', italicBg:'#d2a9a9', italicTextColor:'#d2a9a9', strongBg:'#d47c91', strongBgTextColor:'#ffffff', codeAccent:'#e0b06a' })
        ];
      default:
        return [
          base('기준', ['#fafafa', '#b9a5b4', '#aca2b6']),
          preset('라벤더', ['#f7f1ff', '#c7a8e8', '#aeb8e8'], { textColor:'#f7f1ff', emColor:'#aca8b1', strongColor:'#ffffff', dialogueBg:'#c7a8e8', dialogueTextColor:'#fff8ff', thoughtBg:'#aeb8e8', thoughtTextColor:'#f6f7ff', italicBg:'#d7c9eb', italicTextColor:'#d0c9d9', strongBg:'#c7a8e8', strongBgTextColor:'#fff8ff', codeAccent:'#bca9df' })
        ];
    }
  }


  function isNormalUiStyle() {
    return normalizeUiStyle(CONFIG.uiStyle) === 'normal';
  }

  function clearSgbUiDecorations() {
    // Normal 모드는 배경 레이어와 글자 크기/행간/자간/문단 간격/폰트만 남기고
    // 말풍선, 입력창, 라디오존데, 대사/강조/코드블럭 스킨 마커를 걷어낸다.
    // data-sgb-quote 속성만 제거하면 attr 없는 span이 남아 테마 재전환 시 다시 안 칠해질 수 있으므로,
    // 먼저 확프가 감싼 quote span을 원문 텍스트로 되돌린다.
    try {
      restoreQuoteHighlightsForReact();
    } catch (_) {}

    const attrNames = [
      'data-sgb-bubble-parent',
      'data-sgb-bubble',
      'data-sgb-message-group',
      'data-sgb-edit-bubble',
      'data-sgb-edit-box',
      'data-sgb-input-host',
      'data-sgb-input-box',
      'data-sgb-suggestion-button',
      'data-sgb-top-glass-shell',
      'data-sgb-codeblock',
      'data-sgb-codeblock-head',
      'data-sgb-codeblock-body',
      'data-sgb-radiosonde-skin',
      'data-sgb-radiosonde-head',
      'data-sgb-radiosonde-barline',
      'data-sgb-radiosonde-part',
      'data-sgb-quote'
    ];

    const selector = attrNames.map(name => `[${name}]`).join(', ');
    document.querySelectorAll(selector).forEach(el => {
      if (!(el instanceof HTMLElement)) return;
      attrNames.forEach(name => el.removeAttribute(name));
    });
  }

  function normalizeTextShadowTone(value, fallback = 'dark') {
    const raw = String(value || '').trim().toLowerCase();
    return raw === 'light' ? 'light' : fallback;
  }

  function getTextShadowToneDefinitions() {
    return [
      { value: 'dark', label: '검정' },
      { value: 'light', label: '흰색' }
    ];
  }

  function normalizeChatFont(value, fallback = 'none') {
    const raw = String(value || '').trim().toLowerCase();
    // v1.3.33: 내장 폰트 목록/웹폰트는 제거하고 직접 입력식만 사용한다.
    if (raw === 'custom') return 'custom';
    return 'none';
  }

  function normalizeCustomFontCssUrl(value) {
    const original = String(value || '').trim();
    if (!original) return '';

    // @font-face를 input에 그대로 붙여넣는 사용자가 많아서 조금 더 관대하게 받는다.
    // <style> 래핑, 앞쪽 주석/설명, @fontface 오타, src: local(...), url(...) 순서도 허용한다.
    // v1.9.1: 같은 font-family의 여러 굵기 @font-face 블록을 전부 보존한다.
    // v1.9.5: @import CSS도 fetch로 열어 font-family/variable weight/unicode-range를 자동 반영한다.
    const raw = stripFontCssNoise(original);

    const faceCss = normalizeFontFaceCssText(raw, '');
    if (faceCss) return faceCss;

    const importMatch = raw.match(/@import\s+(?:url\()?(['"]?)(https?:\/\/[^'")\s]+|\/\/[^'")\s]+)\1\)?/i);
    const linkMatch = raw.match(/href\s*=\s*(['"])(https?:\/\/[^'"]+|\/\/[^'"]+)\1/i);
    const urlMatch = raw.match(/^(https?:\/\/[^\s"'<>]+|\/\/[^\s"'<>]+)$/i);

    let url = importMatch?.[2] || linkMatch?.[2] || urlMatch?.[0] || '';
    if (!url) return '';
    if (url.startsWith('//')) url = `https:${url}`;

    return normalizeFontResourceUrl(url);
  }

  function stripFontCssNoise(value) {
    return String(value || '')
      .replace(/<style\b[^>]*>/gi, '')
      .replace(/<\/style>/gi, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();
  }

  function rewriteLegacyFontResourceUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    // v1.9.0: 오래된 RawGit/GitHub raw CSS는 요즘 브라우저에서 폰트 CSS로 안 먹는 경우가 많다.
    // 대표 예: @import url('https://cdn.rawgit.com/moonspam/NanumSquare/master/nanumsquare.css')
    // 같은 경로를 jsDelivr gh CDN으로 바꿔서 @import와 상대 폰트 파일 경로가 정상 동작하게 한다.
    const rawgit = raw.match(/^https?:\/\/(?:cdn\.)?rawgit\.com\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)\/(.+)$/i);
    if (rawgit) {
      const [, user, repo, ref, rest] = rawgit;
      return `https://cdn.jsdelivr.net/gh/${encodeURIComponent(user)}/${encodeURIComponent(repo)}@${encodeURIComponent(ref)}/${rest}`;
    }

    const rawGithub = raw.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)\/(.+)$/i);
    if (rawGithub) {
      const [, user, repo, ref, rest] = rawGithub;
      return `https://cdn.jsdelivr.net/gh/${encodeURIComponent(user)}/${encodeURIComponent(repo)}@${encodeURIComponent(ref)}/${rest}`;
    }

    return raw;
  }

  function normalizeFontResourceUrl(value) {
    try {
      const parsed = new URL(rewriteLegacyFontResourceUrl(value));
      if (!/^https?:$/.test(parsed.protocol)) return '';
      return parsed.href.slice(0, 700);
    } catch (_) {
      return '';
    }
  }

  function resolveFontUrl(url, baseUrl = '') {
    const raw = String(url || '').trim().replace(/^['"]|['"]$/g, '');
    if (!raw || /^data:/i.test(raw)) return '';
    try {
      if (raw.startsWith('//')) return normalizeFontResourceUrl(`https:${raw}`);
      if (/^https?:\/\//i.test(raw)) return normalizeFontResourceUrl(raw);
      if (baseUrl) return normalizeFontResourceUrl(new URL(raw, baseUrl).href);
      return '';
    } catch (_) {
      return '';
    }
  }

  function normalizeFontFormat(value, url = '') {
    const raw = String(value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (raw) return raw.slice(0, 24);
    if (/\.woff2(?:[?#].*)?$/i.test(url)) return 'woff2';
    if (/\.woff(?:[?#].*)?$/i.test(url)) return 'woff';
    if (/\.ttf(?:[?#].*)?$/i.test(url)) return 'truetype';
    if (/\.otf(?:[?#].*)?$/i.test(url)) return 'opentype';
    return 'woff2';
  }

  function normalizeFontCssToken(value, fallback = '') {
    const raw = String(value || '').replace(/[;{}<>]/g, '').trim();
    return (raw || fallback).slice(0, 80);
  }

  function normalizeFontWeightValue(value) {
    const raw = normalizeFontCssToken(value, 'normal').replace(/[^\w\s.-]/g, '').trim();
    // variable font의 font-weight: 100 900 같은 범위 표기를 보존한다.
    if (/^(normal|bold|lighter|bolder)$/i.test(raw)) return raw.toLowerCase();
    const range = raw.match(/^(\d{2,4})\s+(\d{2,4})$/);
    if (range) return `${Math.max(1, Math.min(1000, Number(range[1])))} ${Math.max(1, Math.min(1000, Number(range[2])))}`;
    const one = raw.match(/^\d{2,4}$/);
    if (one) return String(Math.max(1, Math.min(1000, Number(raw))));
    return 'normal';
  }

  function extractFontCssDeclaration(face, property) {
    const escaped = String(property || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return face.match(new RegExp(`${escaped}\\s*:\\s*([^;{}]+)\\s*;?`, 'i'))?.[1] || '';
  }

  function normalizeFontFaceCssText(cssText, baseUrl = '') {
    const raw = stripFontCssNoise(cssText);
    const faceMatches = raw.match(/@font-?face\s*\{[\s\S]*?\}/gi);
    if (!faceMatches?.length) return '';

    const faces = faceMatches.map(faceRaw => {
      const face = faceRaw.replace(/^@fontface/i, '@font-face');
      const familyMatch = face.match(/font-family\s*:\s*(['"]?)([^;'"}]+)\1\s*;?/i);
      const srcDecl = extractFontCssDeclaration(face, 'src');
      const srcMatch = srcDecl.match(/url\((['"]?)([^'")\s]+)\1\)/i);
      if (!familyMatch || !srcMatch) return '';

      const family = normalizeCustomFontFamily(familyMatch[2]);
      const url = resolveFontUrl(srcMatch[2], baseUrl);
      if (!family || !url) return '';

      const format = normalizeFontFormat(
        srcDecl.match(/format\((['"]?)([^'")]+)\1\)/i)?.[2] || '',
        url
      );
      const weight = normalizeFontWeightValue(extractFontCssDeclaration(face, 'font-weight') || 'normal');
      const style = normalizeFontCssToken(extractFontCssDeclaration(face, 'font-style'), 'normal').replace(/[^\w\s.-]/g, '').trim() || 'normal';
      const stretch = normalizeFontCssToken(extractFontCssDeclaration(face, 'font-stretch'), '');
      const display = normalizeFontCssToken(extractFontCssDeclaration(face, 'font-display'), 'swap').replace(/[^\w\s.-]/g, '').trim() || 'swap';
      const unicodeRange = normalizeFontCssToken(extractFontCssDeclaration(face, 'unicode-range'), '').replace(/[^\w\s.,?+*-]/g, '').trim();

      return `@font-face{font-family:"${cssString(family)}";src:url("${cssString(url)}") format("${cssString(format)}");font-weight:${weight};font-style:${style};${stretch ? `font-stretch:${stretch};` : ''}font-display:${display};${unicodeRange ? `unicode-range:${unicodeRange};` : ''}}`;
    }).filter(Boolean);

    return faces.join('\n');
  }

  function normalizeCustomFontFamily(value) {
    return String(value || '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[;{}<>]/g, '')
      .trim()
      .slice(0, 160);
  }

  function cssString(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function normalizeFontSourceInput(value) {
    return String(value ?? '')
      .replace(/[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .slice(0, 24000);
  }

  function normalizeFontLibraryId(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 180);
  }

  function hashFontValue(value) {
    const raw = String(value || '');
    let hash = 2166136261;
    for (let i = 0; i < raw.length; i++) {
      hash ^= raw.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function readFontDraftInput() {
    try {
      const value = localStorage.getItem(SGB_FONT_DRAFT_KEY);
      return value === null ? null : normalizeFontSourceInput(value);
    } catch (_) {
      return null;
    }
  }

  function writeFontDraftInput(value) {
    const normalized = normalizeFontSourceInput(value);
    try {
      if (normalized) localStorage.setItem(SGB_FONT_DRAFT_KEY, normalized);
      else localStorage.removeItem(SGB_FONT_DRAFT_KEY);
    } catch (_) {}
    return normalized;
  }

  function normalizeFontLibraryEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const type = raw.type === 'local' ? 'local' : raw.type === 'web' ? 'web' : '';
    const id = normalizeFontLibraryId(raw.id);
    if (!type || !id) return null;

    const family = normalizeCustomFontFamily(raw.family || '');
    const label = String(raw.label || family || (type === 'local' ? '로컬 폰트' : '웹폰트'))
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    const updatedAt = Number(raw.updatedAt || 0) || 0;

    if (type === 'web') {
      const source = normalizeFontSourceInput(raw.source || '');
      if (!source || !normalizeCustomFontCssUrl(source)) return null;
      return { id, type, source, family, label, updatedAt };
    }

    const name = String(raw.name || label || 'local-font')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .slice(0, 180);
    const format = normalizeFontFormat(raw.format || '', name);
    return { id, type, family, label, name, format, updatedAt };
  }

  function readFontLibraryEntries() {
    try {
      const parsed = safeJsonParse(localStorage.getItem(SGB_FONT_LIBRARY_KEY), []);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeFontLibraryEntry).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  function writeFontLibraryEntries(entries) {
    const seen = new Set();
    const normalized = (Array.isArray(entries) ? entries : [])
      .map(normalizeFontLibraryEntry)
      .filter(entry => {
        if (!entry || seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const locals = normalized.filter(entry => entry.type === 'local').slice(0, 20);
    const webs = normalized.filter(entry => entry.type === 'web').slice(0, 20);
    const next = [...locals, ...webs].sort((a, b) => b.updatedAt - a.updatedAt);

    try {
      localStorage.setItem(SGB_FONT_LIBRARY_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn(`[${SCRIPT_NAME}] font library save failed:`, err);
    }
    return next;
  }

  function getFontLibraryEntry(id) {
    const normalizedId = normalizeFontLibraryId(id);
    return readFontLibraryEntries().find(entry => entry.id === normalizedId) || null;
  }

  function getFontSourceLabel(source, family = '') {
    const explicitFamily = normalizeCustomFontFamily(family);
    if (explicitFamily) return explicitFamily;

    const extracted = extractFontFamilyFromFontFace(source) || inferFontFamilyFromSource(source);
    if (extracted) return extracted;

    try {
      const parsed = new URL(normalizeCustomFontCssUrl(source));
      const tail = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname);
      return (tail || parsed.hostname || '웹폰트').slice(0, 100);
    } catch (_) {
      return '웹폰트 입력';
    }
  }

  function rememberWebFontInput(source, family = '') {
    const rawSource = normalizeFontSourceInput(source).trim();
    const normalizedSource = normalizeCustomFontCssUrl(rawSource);
    if (!rawSource || !normalizedSource) return null;

    const normalizedFamily = normalizeCustomFontFamily(family)
      || extractFontFamilyFromFontFace(normalizedSource)
      || inferFontFamilyFromSource(normalizedSource);
    const id = `web-${hashFontValue(normalizedSource)}`;
    const entry = {
      id,
      type: 'web',
      source: rawSource,
      family: normalizedFamily,
      label: getFontSourceLabel(rawSource, normalizedFamily),
      updatedAt: Date.now()
    };

    const entries = readFontLibraryEntries().filter(item => item.id !== id);
    writeFontLibraryEntries([entry, ...entries]);
    return entry;
  }

  function getCurrentFontSourceInput(settings = CONFIG) {
    const draft = readFontDraftInput();
    if (draft !== null) return draft;
    return normalizeFontSourceInput(settings.customFontSourceInput || settings.customFontCssUrl || '');
  }

  function getSelectedFontLibraryValue(settings = CONFIG) {
    const localId = normalizeFontLibraryId(settings.customFontLocalId);
    if (localId && getFontLibraryEntry(localId)?.type === 'local') return `local:${localId}`;

    const normalizedSource = normalizeCustomFontCssUrl(settings.customFontCssUrl || settings.customFontSourceInput || '');
    if (!normalizedSource) return '';
    const entry = readFontLibraryEntries().find(item => item.type === 'web' && normalizeCustomFontCssUrl(item.source) === normalizedSource);
    return entry ? `web:${entry.id}` : '';
  }

  function renderFontLibraryOptions(settings = CONFIG) {
    const selected = getSelectedFontLibraryValue(settings);
    const entries = readFontLibraryEntries();
    const webEntries = entries.filter(entry => entry.type === 'web');
    const localEntries = entries.filter(entry => entry.type === 'local');
    const options = [`<option value=""${selected ? '' : ' selected'}>저장된 폰트 선택</option>`];

    if (webEntries.length) {
      options.push('<optgroup label="웹폰트 입력 기록">');
      webEntries.forEach(entry => {
        const value = `web:${entry.id}`;
        options.push(`<option value="${htmlAttrValue(value)}"${selected === value ? ' selected' : ''}>${htmlTextValue(entry.label || entry.family || '웹폰트')}</option>`);
      });
      options.push('</optgroup>');
    }

    if (localEntries.length) {
      options.push('<optgroup label="로컬 폰트 파일">');
      localEntries.forEach(entry => {
        const value = `local:${entry.id}`;
        options.push(`<option value="${htmlAttrValue(value)}"${selected === value ? ' selected' : ''}>${htmlTextValue(entry.label || entry.family || entry.name || '로컬 폰트')}</option>`);
      });
      options.push('</optgroup>');
    }

    if (!webEntries.length && !localEntries.length) {
      options.push('<option value="" disabled>저장된 폰트가 없어요</option>');
    }

    return options.join('');
  }

  function inferLocalFontFamily(fileName) {
    const base = String(fileName || 'Local Font')
      .replace(/\.(?:woff2?|ttf|otf)$/i, '')
      .replace(/(?:[-_ ](?:thin|extralight|ultralight|light|regular|normal|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|italic|oblique|variable|vf))+$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return normalizeCustomFontFamily(base || 'SGB Local Font');
  }

  function getLocalFontFormat(fileName, mimeType = '') {
    const lowerName = String(fileName || '').toLowerCase();
    const lowerMime = String(mimeType || '').toLowerCase();
    if (lowerName.endsWith('.woff2') || lowerMime.includes('woff2')) return 'woff2';
    if (lowerName.endsWith('.woff') || lowerMime.includes('woff')) return 'woff';
    if (lowerName.endsWith('.ttf') || lowerMime.includes('ttf') || lowerMime.includes('truetype')) return 'truetype';
    if (lowerName.endsWith('.otf') || lowerMime.includes('otf') || lowerMime.includes('opentype')) return 'opentype';
    return '';
  }

  function openFontDb() {
    if (!window.indexedDB) return Promise.resolve(null);
    if (state.fontDbPromise) return state.fontDbPromise;

    state.fontDbPromise = new Promise(resolve => {
      let request;
      try {
        request = indexedDB.open(SGB_FONT_DB_NAME, SGB_FONT_DB_VERSION);
      } catch (err) {
        console.warn(`[${SCRIPT_NAME}] font IndexedDB open failed:`, err);
        resolve(null);
        return;
      }

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SGB_FONT_STORE_NAME)) {
          db.createObjectStore(SGB_FONT_STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => {
        console.warn(`[${SCRIPT_NAME}] font IndexedDB error:`, request.error);
        resolve(null);
      };
      request.onblocked = () => resolve(null);
    });

    return state.fontDbPromise;
  }

  async function writeLocalFontRecord(record) {
    const db = await openFontDb();
    if (!db || !db.objectStoreNames.contains(SGB_FONT_STORE_NAME)) return false;

    return await new Promise(resolve => {
      let tx;
      try {
        tx = db.transaction(SGB_FONT_STORE_NAME, 'readwrite');
        tx.objectStore(SGB_FONT_STORE_NAME).put(record);
      } catch (err) {
        console.warn(`[${SCRIPT_NAME}] local font save failed:`, err);
        resolve(false);
        return;
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  }

  async function readLocalFontRecord(id) {
    const normalizedId = normalizeFontLibraryId(id);
    if (!normalizedId) return null;
    const db = await openFontDb();
    if (!db || !db.objectStoreNames.contains(SGB_FONT_STORE_NAME)) return null;

    return await new Promise(resolve => {
      let request;
      try {
        request = db.transaction(SGB_FONT_STORE_NAME, 'readonly').objectStore(SGB_FONT_STORE_NAME).get(normalizedId);
      } catch (_) {
        resolve(null);
        return;
      }
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  }

  async function deleteLocalFontRecord(id) {
    const normalizedId = normalizeFontLibraryId(id);
    if (!normalizedId) return false;
    const db = await openFontDb();
    if (!db || !db.objectStoreNames.contains(SGB_FONT_STORE_NAME)) return false;

    return await new Promise(resolve => {
      let tx;
      try {
        tx = db.transaction(SGB_FONT_STORE_NAME, 'readwrite');
        tx.objectStore(SGB_FONT_STORE_NAME).delete(normalizedId);
      } catch (_) {
        resolve(false);
        return;
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  }

  async function saveLocalFontFile(file) {
    if (!(file instanceof File)) throw new Error('폰트 파일을 선택하지 않았어요.');
    const format = getLocalFontFormat(file.name, file.type);
    if (!format) throw new Error('woff2, woff, ttf, otf 파일만 사용할 수 있어요.');
    if (file.size <= 0) throw new Error('빈 폰트 파일은 저장할 수 없어요.');
    if (file.size > 30 * 1024 * 1024) throw new Error('로컬 폰트 파일은 30MB 이하만 저장할 수 있어요.');

    const family = inferLocalFontFamily(file.name);
    const id = `local-${hashFontValue(`${file.name}|${file.size}|${file.lastModified}`)}`;
    const record = {
      id,
      blob: file,
      name: file.name,
      family,
      format,
      size: file.size,
      updatedAt: Date.now()
    };

    const saved = await writeLocalFontRecord(record);
    if (!saved) throw new Error('브라우저 로컬 저장소에 폰트를 저장하지 못했어요.');

    const entry = {
      id,
      type: 'local',
      family,
      label: family || file.name,
      name: file.name,
      format,
      updatedAt: record.updatedAt
    };
    const entries = readFontLibraryEntries().filter(item => item.id !== id);
    writeFontLibraryEntries([entry, ...entries]);

    const previous = state.localFontRuntime.get(id);
    if (previous?.objectUrl) URL.revokeObjectURL(previous.objectUrl);
    state.localFontRuntime.delete(id);
    return entry;
  }

  async function loadLocalFontRuntime(id) {
    const normalizedId = normalizeFontLibraryId(id);
    if (!normalizedId) return null;
    const cached = state.localFontRuntime.get(normalizedId);
    if (cached?.objectUrl) return cached;
    if (state.localFontLoadId === normalizedId && state.localFontLoadStatus === 'loading') return null;

    state.localFontLoadId = normalizedId;
    state.localFontLoadStatus = 'loading';
    const record = await readLocalFontRecord(normalizedId);
    if (state.localFontLoadId !== normalizedId) return null;

    if (!record?.blob) {
      state.localFontLoadStatus = 'failed';
      return null;
    }

    const objectUrl = URL.createObjectURL(record.blob);
    const runtime = {
      ...record,
      family: normalizeCustomFontFamily(record.family || getFontLibraryEntry(normalizedId)?.family || 'SGB Local Font'),
      format: normalizeFontFormat(record.format || '', record.name || ''),
      objectUrl
    };
    state.localFontRuntime.set(normalizedId, runtime);
    state.localFontLoadStatus = 'done';
    return runtime;
  }

  async function removeFontLibraryEntry(value) {
    const [type, rawId] = String(value || '').split(':');
    const id = normalizeFontLibraryId(rawId);
    if (!id || (type !== 'web' && type !== 'local')) return false;

    writeFontLibraryEntries(readFontLibraryEntries().filter(entry => entry.id !== id));
    if (type === 'local') {
      const runtime = state.localFontRuntime.get(id);
      if (runtime?.objectUrl) URL.revokeObjectURL(runtime.objectUrl);
      state.localFontRuntime.delete(id);
      await deleteLocalFontRecord(id);
      if (normalizeFontLibraryId(CONFIG.customFontLocalId) === id) {
        const source = normalizeCustomFontCssUrl(CONFIG.customFontCssUrl || CONFIG.customFontSourceInput || '');
        const sourceFamily = extractFontFamilyFromFontFace(source) || inferFontFamilyFromSource(source) || '';
        saveBackgroundSettings({
          customFontLocalId: '',
          customFontFamily: source ? sourceFamily : '',
          chatFont: source ? 'custom' : 'none'
        }, { skipRefresh: true });
      }
    }
    return true;
  }



  function htmlTextareaValue(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;');
  }

  function htmlTextValue(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function htmlAttrValue(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function cssFontStack(value) {
    const raw = normalizeCustomFontFamily(value);
    if (!raw) return '';
    if (/[,"']/.test(raw)) return raw;
    return `"${cssString(raw)}"`;
  }

  function extractFontFamilyFromFontFace(value) {
    const raw = String(value || '').trim();
    const faceMatch = raw.match(/@font-?face\s*\{[\s\S]*?\}/i);
    if (!faceMatch) return '';
    const familyMatch = faceMatch[0].match(/font-family\s*:\s*(['"]?)([^;'"}]+)\1\s*;?/i);
    return normalizeCustomFontFamily(familyMatch?.[2] || '');
  }

  function extractFontFamiliesFromFontFace(value) {
    const raw = String(value || '').trim();
    const families = [];
    const seen = new Set();
    const faceMatches = raw.match(/@font-?face\s*\{[\s\S]*?\}/gi) || [];

    faceMatches.forEach(face => {
      const familyMatch = face.match(/font-family\s*:\s*(['"]?)([^;'"}]+)\1\s*;?/i);
      const family = normalizeCustomFontFamily(familyMatch?.[2] || '');
      const key = family.toLowerCase();
      if (!family || seen.has(key)) return;
      seen.add(key);
      families.push(family);
    });

    return families;
  }

  function getKnownFontFamilyCandidates(source) {
    const lower = String(source || '').toLowerCase();

    // Mona는 글씨 크기값이 아니라 font-family 자체를 Mona10/Mona12처럼 바꿔야 모양이 바뀐다.
    // fetch가 끝나면 실제 CSS의 @font-face 목록으로 보강하고, fetch 전에는 자주 쓰는 후보를 먼저 보여준다.
    if (lower.includes('monadabxy/mona-font') || /\/mona\.css(?:[?#].*)?$/i.test(String(source || ''))) {
      return ['Mona12', 'Mona10', 'Mona10x12', 'Mona8x12', 'MonaS12', 'MonaS10', 'MonaS10x12', 'MonaS8x12'];
    }

    return [];
  }

  function getAvailableCustomFontFamilies(settings = CONFIG) {
    const source = normalizeCustomFontCssUrl(settings.customFontCssUrl);
    const explicit = normalizeCustomFontFamily(settings.customFontFamily);
    const families = [];
    const seen = new Set();
    const add = family => {
      const normalized = normalizeCustomFontFamily(family);
      const key = normalized.toLowerCase();
      if (!normalized || seen.has(key)) return;
      seen.add(key);
      families.push(normalized);
    };

    if (explicit) add(explicit);
    const localEntry = getFontLibraryEntry(settings.customFontLocalId);
    if (localEntry?.type === 'local') add(localEntry.family);
    getKnownFontFamilyCandidates(source).forEach(add);
    extractFontFamiliesFromFontFace(source).forEach(add);

    if (source && state.fontResolveSource === source && state.resolvedCustomFontCss) {
      extractFontFamiliesFromFontFace(state.resolvedCustomFontCss).forEach(add);
      (state.resolvedCustomFontFamilies || []).forEach(add);
    }

    add(inferFontFamilyFromSource(source));
    add(getEffectiveCustomFontFamily({ ...settings, customFontFamily: explicit }));

    return families;
  }

  function renderFontFamilyOptions(settings = CONFIG) {
    const explicit = normalizeCustomFontFamily(settings.customFontFamily);
    const autoFamily = getEffectiveCustomFontFamily({ ...settings, customFontFamily: '' });
    const families = getAvailableCustomFontFamilies(settings);
    const autoLabel = autoFamily ? `자동 감지: ${autoFamily}` : '자동 감지';

    return [
      `<option value=""${explicit ? '' : ' selected'}>${htmlTextValue(autoLabel)}</option>`,
      ...families.map(family => `<option value="${htmlAttrValue(family)}"${explicit === family ? ' selected' : ''}>${htmlTextValue(family)}</option>`)
    ].join('');
  }

  function isDirectFontResource(value) {
    return /\.(?:woff2?|ttf|otf)(?:[?#].*)?$/i.test(String(value || '').trim());
  }

  function inferDirectFontWeightRangeFromUrl(value) {
    const raw = String(value || '').toLowerCase();
    return /(?:variable|varfont|vf|var)/i.test(raw) ? '100 900' : 'normal';
  }

  function inferFontFamilyFromSource(value) {
    const source = String(value || '').trim();
    if (!source) return '';

    const lower = source.toLowerCase();

    // 자주 쓰는 웹폰트 CSS는 이름을 알잘딱으로 잡는다.
    if (lower.includes('monadabxy/mona-font') || /\/mona\.css(?:[?#].*)?$/i.test(source)) return 'Mona12';
    if (lower.includes('moonspam/nanumsquare') || /\/nanumsquare(?:\.min)?\.css(?:[?#].*)?$/i.test(source)) return 'NanumSquare';
    if (lower.includes('wanteddev/wanted-sans') || lower.includes('wantedsansvariable')) return 'Wanted Sans Variable';
    if (lower.includes('projectnoonnu/noonfonts_suit') || /suit[-_]?/i.test(source)) return 'SUIT';

    try {
      const parsed = new URL(source);
      const familyParam = parsed.searchParams.get('family');
      if (familyParam) {
        const firstFamily = decodeURIComponent(familyParam)
          .split('|')[0]
          .split(':')[0]
          .replace(/\+/g, ' ')
          .trim();
        if (firstFamily) return normalizeCustomFontFamily(firstFamily);
      }

      const pathname = decodeURIComponent(parsed.pathname || '');
      const file = pathname.split('/').filter(Boolean).pop() || '';
      const basename = file.replace(/\.(css|woff2?|ttf|otf)$/i, '').replace(/[-_]+/g, ' ').trim();

      // 파일명 기반은 직접 폰트 파일일 때만 임시 추정한다.
      // CSS 파일은 안에 font-family가 따로 있을 수 있어 함부로 적용하지 않는다.
      if (isDirectFontResource(source) && basename) return 'SGBCustomUserFont';
    } catch (_) {}

    return '';
  }

  function getEffectiveCustomFontFamily(settings = CONFIG) {
    const explicit = normalizeCustomFontFamily(settings.customFontFamily);
    if (explicit) return explicit;

    const localId = normalizeFontLibraryId(settings.customFontLocalId);
    if (localId) {
      const runtime = state.localFontRuntime.get(localId);
      const localEntry = getFontLibraryEntry(localId);
      const localFamily = normalizeCustomFontFamily(runtime?.family || localEntry?.family || '');
      if (localFamily) return localFamily;
    }

    const source = normalizeCustomFontCssUrl(settings.customFontCssUrl);
    const extracted = extractFontFamilyFromFontFace(source);
    if (extracted) return extracted;

    if (source && state.fontResolveSource === source && state.resolvedCustomFontFamily) {
      return state.resolvedCustomFontFamily;
    }

    if (isDirectFontResource(source)) return 'SGBCustomUserFont';

    return inferFontFamilyFromSource(source);
  }

  function getChatFontLabel(settings = CONFIG) {
    const family = getEffectiveCustomFontFamily(settings);
    if (normalizeFontLibraryId(settings.customFontLocalId)) return family ? `${family} · 로컬` : '로컬 폰트 불러오는 중';

    const rawInput = normalizeFontSourceInput(settings.customFontSourceInput || getCurrentFontSourceInput(settings)).trim();
    if (rawInput && !normalizeCustomFontCssUrl(rawInput)) return '입력 저장됨 · 형식 확인';
    return family ? family : '없음';
  }

  function resolveImportedCustomFontCss(fontSource) {
    if (!fontSource || /^@font-face\s*\{/i.test(fontSource) || isDirectFontResource(fontSource)) return;
    if (state.fontResolveSource === fontSource && (state.fontResolveStatus === 'loading' || state.fontResolveStatus === 'done')) return;

    state.fontResolveSource = fontSource;
    state.fontResolveStatus = 'loading';
    state.resolvedCustomFontCss = '';
    state.resolvedCustomFontFamilies = getKnownFontFamilyCandidates(fontSource);
    state.resolvedCustomFontFamily = inferFontFamilyFromSource(fontSource) || state.resolvedCustomFontFamilies[0] || '';

    fetch(fontSource, { cache: 'force-cache', credentials: 'omit' })
      .then(response => response.ok ? response.text() : '')
      .then(cssText => {
        if (state.fontResolveSource !== fontSource) return;
        const normalizedCss = normalizeFontFaceCssText(cssText, fontSource);
        const families = extractFontFamiliesFromFontFace(normalizedCss);
        const inferred = inferFontFamilyFromSource(fontSource);
        const family = (inferred && families.some(item => item.toLowerCase() === inferred.toLowerCase()))
          ? inferred
          : (families[0] || inferred || state.resolvedCustomFontFamilies[0] || '');
        state.resolvedCustomFontCss = normalizedCss;
        state.resolvedCustomFontFamilies = families.length ? families : getKnownFontFamilyCandidates(fontSource);
        state.resolvedCustomFontFamily = family;
        state.fontResolveStatus = 'done';

        // @import CSS를 실제 @font-face로 펼친 뒤 family명을 다시 계산해 즉시 반영한다.
        injectCustomFontStyle();
        applyCssVars();
        syncSettingsUi();
      })
      .catch(() => {
        if (state.fontResolveSource !== fontSource) return;
        state.fontResolveStatus = 'failed';
        state.resolvedCustomFontCss = '';
        state.resolvedCustomFontFamilies = getKnownFontFamilyCandidates(fontSource);
        state.resolvedCustomFontFamily = inferFontFamilyFromSource(fontSource) || state.resolvedCustomFontFamilies[0] || '';
      });
  }

  function injectCustomFontStyle() {
    const id = `${IDS.style}-custom-font`;
    const existing = document.getElementById(id);
    const fontSource = normalizeCustomFontCssUrl(CONFIG.customFontCssUrl);

    let content = '';
    const localId = normalizeFontLibraryId(CONFIG.customFontLocalId);
    if (localId) {
      const runtime = state.localFontRuntime.get(localId);
      if (!runtime?.objectUrl) {
        existing?.remove();
        loadLocalFontRuntime(localId).then(loaded => {
          if (!loaded || normalizeFontLibraryId(CONFIG.customFontLocalId) !== localId) return;
          injectCustomFontStyle();
          applyCssVars();
          syncSettingsUi();
        }).catch(err => {
          console.warn(`[${SCRIPT_NAME}] local font load failed:`, err);
        });
        return;
      }

      const family = getEffectiveCustomFontFamily(CONFIG) || runtime.family || 'SGB Local Font';
      content = `@font-face{font-family:"${cssString(family)}";src:url("${cssString(runtime.objectUrl)}") format("${cssString(runtime.format || normalizeFontFormat('', runtime.name || ''))}");font-weight:100 900;font-style:normal;font-display:swap;}`;
    } else if (fontSource) {
      if (/^@font-face\s*\{/i.test(fontSource)) {
        content = fontSource;
      } else if (/\.(?:woff2?|ttf|otf)(?:[?#].*)?$/i.test(fontSource)) {
        const family = getEffectiveCustomFontFamily(CONFIG);
        if (family) {
          content = `@font-face{font-family:"${cssString(family)}";src:url("${cssString(fontSource)}") format("${cssString(normalizeFontFormat('', fontSource))}");font-weight:${inferDirectFontWeightRangeFromUrl(fontSource)};font-style:normal;font-display:swap;}`;
        }
      } else {
        resolveImportedCustomFontCss(fontSource);
        content = state.fontResolveSource === fontSource && state.resolvedCustomFontCss
          ? state.resolvedCustomFontCss
          : `@import url("${cssString(fontSource)}");`;
      }
    }

    if (!content) {
      existing?.remove();
      return;
    }

    if (existing && existing.textContent === content) return;

    existing?.remove();
    const style = document.createElement('style');
    style.id = id;
    style.textContent = content;
    document.head.appendChild(style);
  }

  function getHighlightColorSettingDefinitions() {
    return [
      { key: 'dialogueBg', label: '대사 배경색', when: 'dialogueBgEnabled' },
      { key: 'dialogueTextColor', label: '대사 글자색', when: 'dialogueBgEnabled' },
      { key: 'thoughtBg', label: '생각 배경색', when: 'thoughtBgEnabled' },
      { key: 'thoughtTextColor', label: '생각 글자색', when: 'thoughtBgEnabled' },
      { key: 'italicBg', label: '이탤릭 배경색', when: 'italicBgEnabled' },
      { key: 'italicTextColor', label: '이탤릭 글자색', when: 'italicBgEnabled' },
      { key: 'strongBg', label: '굵게 배경색', when: 'strongBgEnabled' },
      { key: 'strongBgTextColor', label: '굵게 글자색', when: 'strongBgEnabled' },
      { key: 'codeAccent', label: '코드블록 배경색', when: 'codeBlockBgEnabled' }
    ];
  }

  function getHighlightToggleDefinitions() {
    return [
      { key: 'dialogueBgEnabled', label: '대사 배경', desc: '" " / 「 」 / ❝ ❞ 대사를 감지해요.' },
      { key: 'thoughtBgEnabled', label: '생각 배경', desc: "ASCII '작은따옴표'만 감지해요." },
      { key: 'italicBgEnabled', label: '이탤릭 배경', desc: '*이탤릭*으로 렌더된 부분만 감지해요.' },
      { key: 'strongBgEnabled', label: '굵게 배경', desc: '**굵게**로 렌더된 부분만 감지해요.' },
      { key: 'codeBlockBgEnabled', label: '코드블록 배경', desc: '코드블록 박스 배경을 켜거나 꺼요.' },
      { key: 'markdownDecorEnabled', label: '마크다운 꾸미기', desc: '제목·인용문·목록·구분선·링크·표 등 렌더된 마크다운을 테마톤으로 꾸며요.' }
    ];
  }

  function isAnyQuoteHighlightEnabled() {
    return !!(CONFIG.dialogueBgEnabled || CONFIG.thoughtBgEnabled);
  }


  const THEME_COLOR_SETTING_KEYS = Object.freeze([
    'textColor',
    'emColor',
    'strongColor',
    'italicTextColor',
    'strongBgTextColor',
    'dialogueBg',
    'dialogueTextColor',
    'thoughtBg',
    'thoughtTextColor',
    'italicBg',
    'strongBg',
    'codeAccent'
  ]);

  function createCustomColorBackup(settings = CONFIG) {
    const defaults = DEFAULT_BACKGROUND_SETTINGS;
    return THEME_COLOR_SETTING_KEYS.reduce((backup, key) => {
      backup[key] = normalizeHexColor(settings?.[key], defaults[key]);
      return backup;
    }, {});
  }

  function normalizeCustomColorBackup(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!THEME_COLOR_SETTING_KEYS.some(key => raw[key] !== undefined)) return null;

    const defaults = DEFAULT_BACKGROUND_SETTINGS;
    return THEME_COLOR_SETTING_KEYS.reduce((backup, key) => {
      backup[key] = normalizeHexColor(raw[key], defaults[key]);
      return backup;
    }, {});
  }

  function getPalettePatchForStyle(style, index = 0) {
    const normalizedStyle = normalizeUiStyle(style);
    const palettes = getUiStylePaletteDefinitions(normalizedStyle);
    const paletteIndex = Math.max(0, Math.min(palettes.length - 1, Math.round(Number(index) || 0)));
    const palette = palettes[paletteIndex] || palettes[0];

    return {
      uiStyle: normalizedStyle,
      uiPaletteIndex: paletteIndex,
      ...(palette?.patch || { themeRecommendedColorsEnabled: true })
    };
  }

  function getThemeColorTogglePatch(nextEnabled) {
    if (!nextEnabled) {
      const backup = normalizeCustomColorBackup(CONFIG.customColorBackup);
      return backup
        ? { themeRecommendedColorsEnabled: false, ...backup }
        : { themeRecommendedColorsEnabled: false };
    }

    const style = normalizeUiStyle(CONFIG.uiStyle);
    const palettePatch = getPalettePatchForStyle(style, CONFIG.uiPaletteIndex);
    return {
      customColorBackup: createCustomColorBackup(CONFIG),
      ...palettePatch,
      themeRecommendedColorsEnabled: true
    };
  }

  function isNonEmptySettingsObject(value) {
    return !!(value && typeof value === 'object' && Object.keys(value).length > 0);
  }

  function readStorageJson(key) {
    try {
      const parsed = safeJsonParse(localStorage.getItem(key), {});
      return isNonEmptySettingsObject(parsed) ? parsed : {};
    } catch (err) {
      console.warn(`[${SCRIPT_NAME}] settings storage read failed:`, err);
      return {};
    }
  }

  function readSettingsCookie() {
    try {
      const prefix = `${encodeURIComponent(SGB_SETTINGS_COOKIE)}=`;
      const item = String(document.cookie || '')
        .split(';')
        .map(part => part.trim())
        .find(part => part.startsWith(prefix));
      if (!item) return {};
      const parsed = safeJsonParse(decodeURIComponent(item.slice(prefix.length)), {});
      return isNonEmptySettingsObject(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeSettingsCookie(serialized) {
    try {
      if (!serialized || serialized.length > 3600) return;
      document.cookie = `${encodeURIComponent(SGB_SETTINGS_COOKIE)}=${encodeURIComponent(serialized)}; max-age=31536000; path=/; samesite=lax`;
    } catch (_) {}
  }

  function removeSettingsCookie() {
    try {
      document.cookie = `${encodeURIComponent(SGB_SETTINGS_COOKIE)}=; max-age=0; path=/; samesite=lax`;
    } catch (_) {}
  }

  function writeSavedSettings(settings) {
    const current = normalizeBackgroundSettings(settings || {});
    const serialized = JSON.stringify(current);
    state.volatileSettings = { ...current };
    state.lastCommittedSettingsText = serialized;

    try {
      localStorage.setItem(SGB_SETTINGS_KEY, serialized);
      localStorage.setItem(SGB_SETTINGS_BACKUP_KEY, serialized);
    } catch (err) {
      console.warn(`[${SCRIPT_NAME}] settings storage write failed; using fallback:`, err);
      try { localStorage.setItem(SGB_SETTINGS_BACKUP_KEY, serialized); } catch (_) {}
    }

    writeSettingsCookie(serialized);
    return current;
  }

  function persistCurrentSettings(reason = 'persist') {
    try {
      return writeSavedSettings(CONFIG);
    } catch (err) {
      console.warn(`[${SCRIPT_NAME}] settings persist failed:`, reason, err);
      return normalizeBackgroundSettings(CONFIG);
    }
  }

  function readSavedSettings() {
    const primary = readStorageJson(SGB_SETTINGS_KEY);
    if (isNonEmptySettingsObject(primary)) {
      state.volatileSettings = { ...primary };
      return primary;
    }

    const backup = readStorageJson(SGB_SETTINGS_BACKUP_KEY);
    if (isNonEmptySettingsObject(backup)) {
      state.volatileSettings = { ...backup };
      return backup;
    }

    const cookie = readSettingsCookie();
    if (isNonEmptySettingsObject(cookie)) {
      state.volatileSettings = { ...cookie };
      return cookie;
    }

    return isNonEmptySettingsObject(state.volatileSettings) ? { ...state.volatileSettings } : {};
  }

  function normalizeBackgroundSettings(raw = {}) {
    const defaults = getDefaultBackgroundSettings();

    return {
      enabled: raw.enabled === undefined ? defaults.enabled : raw.enabled !== false,
      blurPx: clampValue(raw.blurPx, 0, 22, defaults.blurPx),
      imageOpacity: clampValue(raw.imageOpacity, 0.12, 1, defaults.imageOpacity),
      dim: clampValue(raw.dim, 0, 0.78, defaults.dim),
      scale: clampValue(raw.scale, 0.86, 1.28, defaults.scale),
      brightness: clampValue(raw.brightness, 0.42, 1.22, defaults.brightness),
      saturate: clampValue(raw.saturate, 0.55, 1.65, defaults.saturate),
      uiOpacity: (() => {
        if (raw.uiOpacity !== undefined) return clampValue(raw.uiOpacity, 0.18, 1, defaults.uiOpacity);
        if (raw.themeSurfaceOpacity !== undefined) return clampValue(raw.themeSurfaceOpacity, 0.18, 1, defaults.uiOpacity);
        if (raw.glassBlurPx !== undefined) {
          const legacyBlur = clampValue(raw.glassBlurPx, 0, 24, 18);
          return clampValue(0.18 + (legacyBlur / 24) * 0.82, 0.18, 1, defaults.uiOpacity);
        }
        return defaults.uiOpacity;
      })(),
      themeRecommendedColorsEnabled: raw.themeRecommendedColorsEnabled === undefined ? defaults.themeRecommendedColorsEnabled : raw.themeRecommendedColorsEnabled !== false,
      uiPaletteIndex: Math.round(clampValue(raw.uiPaletteIndex, 0, 9, defaults.uiPaletteIndex)),
      customColorBackup: normalizeCustomColorBackup(raw.customColorBackup),
      markdownDecorEnabled: raw.markdownDecorEnabled === undefined ? defaults.markdownDecorEnabled : raw.markdownDecorEnabled !== false,

      textColor: normalizeHexColor(raw.textColor, defaults.textColor),
      emColor: normalizeHexColor(raw.emColor, defaults.emColor),
      strongColor: normalizeHexColor(raw.strongColor, defaults.strongColor),
      italicTextColor: normalizeHexColor(raw.italicTextColor || raw.italicHighlightTextColor, defaults.italicTextColor),
      strongBgTextColor: normalizeHexColor(raw.strongBgTextColor || raw.strongHighlightTextColor, defaults.strongBgTextColor),
      textShadowEnabled: raw.textShadowEnabled === undefined ? defaults.textShadowEnabled : raw.textShadowEnabled !== false,
      textShadowTone: normalizeTextShadowTone(raw.textShadowTone, defaults.textShadowTone),
      customFontCssUrl: normalizeCustomFontCssUrl(raw.customFontCssUrl || raw.chatFontCssUrl || raw.customFontSourceInput || ''),
      customFontFamily: normalizeCustomFontFamily(raw.customFontFamily || raw.chatFontFamily || ''),
      customFontSourceInput: normalizeFontSourceInput(raw.customFontSourceInput !== undefined ? raw.customFontSourceInput : (raw.customFontCssUrl || raw.chatFontCssUrl || '')),
      customFontLocalId: normalizeFontLibraryId(raw.customFontLocalId || ''),
      chatFont: (normalizeFontLibraryId(raw.customFontLocalId || '') || normalizeCustomFontFamily(raw.customFontFamily || raw.chatFontFamily || '') || normalizeCustomFontCssUrl(raw.customFontCssUrl || raw.chatFontCssUrl || raw.customFontSourceInput || '')) ? 'custom' : normalizeChatFont(raw.chatFont, defaults.chatFont),
      textScale: clampValue(raw.textScale, 0.80, 1.20, defaults.textScale),
      codeTextScale: clampValue(raw.codeTextScale, 0.70, 1.20, defaults.codeTextScale),
      fontWeight: Math.round(clampValue(raw.fontWeight, 300, 900, defaults.fontWeight) / 100) * 100,
      lineHeight: clampValue(raw.lineHeight, 1.35, 2.10, defaults.lineHeight),
      letterSpacing: clampValue(raw.letterSpacing, -0.03, 0.08, defaults.letterSpacing),
      paragraphSpacing: clampValue(raw.paragraphSpacing, 0, 1.60, defaults.paragraphSpacing),

      dialogueBgEnabled: raw.dialogueBgEnabled === undefined ? defaults.dialogueBgEnabled : raw.dialogueBgEnabled !== false,
      thoughtBgEnabled: raw.thoughtBgEnabled === undefined ? defaults.thoughtBgEnabled : raw.thoughtBgEnabled !== false,
      italicBgEnabled: raw.italicBgEnabled === undefined ? defaults.italicBgEnabled : raw.italicBgEnabled !== false,
      strongBgEnabled: raw.strongBgEnabled === undefined ? defaults.strongBgEnabled : raw.strongBgEnabled !== false,
      codeBlockBgEnabled: raw.codeBlockBgEnabled === undefined ? defaults.codeBlockBgEnabled : raw.codeBlockBgEnabled !== false,

      dialogueBg: normalizeHexColor(raw.dialogueBg, defaults.dialogueBg),
      dialogueTextColor: normalizeHexColor(raw.dialogueTextColor, defaults.dialogueTextColor),
      thoughtBg: normalizeHexColor(raw.thoughtBg, defaults.thoughtBg),
      thoughtTextColor: normalizeHexColor(raw.thoughtTextColor, defaults.thoughtTextColor),
      italicBg: normalizeHexColor(raw.italicBg, defaults.italicBg),
      strongBg: normalizeHexColor(raw.strongBg, defaults.strongBg),
      codeAccent: normalizeHexColor(raw.codeAccent, defaults.codeAccent),

      highlightShape: normalizeHighlightShape(raw.highlightShape, defaults.highlightShape),
      uiStyle: normalizeUiStyle(raw.uiStyle, defaults.uiStyle)
    };
  }

  function applySavedSettingsToConfig() {
    const saved = normalizeBackgroundSettings(readSavedSettings());
    const draft = readFontDraftInput();
    if (draft !== null) {
      saved.customFontSourceInput = draft;
      if (!saved.customFontLocalId) {
        const normalizedDraft = normalizeCustomFontCssUrl(draft);
        if (normalizedDraft) {
          saved.customFontCssUrl = normalizedDraft;
          saved.chatFont = 'custom';
        } else if (!draft.trim()) {
          saved.customFontCssUrl = '';
          saved.chatFont = saved.customFontFamily ? 'custom' : 'none';
        }
      }
    }
    Object.assign(CONFIG, saved);
    return saved;
  }

  function shouldReapplyDecorationsForPatch(patch = {}) {
    if (!patch || typeof patch !== 'object') return false;
    return [
      'uiStyle',
      'dialogueBgEnabled',
      'thoughtBgEnabled',
      'italicBgEnabled',
      'strongBgEnabled',
      'codeBlockBgEnabled',
      'highlightShape'
    ].some(key => Object.prototype.hasOwnProperty.call(patch, key));
  }

  function scheduleSettingsDecorationReapply(reason = 'settings-decoration', delay = 0) {
    clearTimeout(state.settingsDecorateTimer);
    state.settingsDecorateTimer = window.setTimeout(() => {
      try {
        if (!isEpisodePath()) return;
        if (!shouldApplyThemeSkin()) return;

        document.documentElement.classList.add(CLS_ROOM, CLS_ACTIVE);

        // 테마/강조 옵션 전환 직후에는 기존 길이 캐시 때문에 quote wrapper가 한 박자 늦게 붙을 수 있다.
        // 캐시를 초기화하고 2-pass로 다시 감싸 새로고침 없이 안쪽 칠하기가 바로 살아나게 한다.
        resetQuoteDecorateCache(document);
        decorateLayout();

        if (isAnyQuoteHighlightEnabled() && !isNormalUiStyle()) {
          window.setTimeout(() => {
            try { decorateQuotes(); } catch (err) { console.warn(`[${SCRIPT_NAME}] quote reapply failed:`, err); }
          }, 520);
          window.setTimeout(() => {
            try { decorateQuotes(); } catch (err) { console.warn(`[${SCRIPT_NAME}] quote reapply failed:`, err); }
          }, 1100);
        }
      } catch (err) {
        console.warn(`[${SCRIPT_NAME}] settings decoration reapply failed:`, err);
      }
    }, Math.max(0, Number(delay) || 0));
  }

  function saveBackgroundSettings(patch = {}, options = {}) {
    const shouldReapplyDecorations = shouldReapplyDecorationsForPatch(patch);
    const current = normalizeBackgroundSettings({ ...readSavedSettings(), ...CONFIG, ...patch });
    writeSavedSettings(current);
    Object.assign(CONFIG, current);
    applyCssVars();
    syncSettingsUi();

    if (!CONFIG.enabled) {
      clearBackgroundImage();
      if (shouldApplyThemeSkin() && isEpisodePath()) {
        document.documentElement.classList.add(CLS_ROOM, CLS_ACTIVE);
        decorateLayout();
      }
    } else if (!options.skipRefresh) {
      scheduleRefresh('settings', 0);
    }

    if (shouldReapplyDecorations) {
      scheduleSettingsDecorationReapply('settings-decoration', 0);
    }

    return current;
  }

  function resetBackgroundSettings() {
    const defaults = getDefaultBackgroundSettings();
    try {
      localStorage.removeItem(SGB_SETTINGS_KEY);
      localStorage.removeItem(SGB_SETTINGS_BACKUP_KEY);
    } catch (_) {}
    removeSettingsCookie();
    state.volatileSettings = {};
    state.lastCommittedSettingsText = '';
    writeFontDraftInput('');
    Object.assign(CONFIG, defaults);
    applyCssVars();
    syncSettingsUi();
    if (CONFIG.enabled) scheduleRefreshBurst('settings-reset');
    else {
      clearBackgroundImage();
      if (shouldApplyThemeSkin() && isEpisodePath()) {
        document.documentElement.classList.add(CLS_ROOM, CLS_ACTIVE);
        decorateLayout();
      }
    }
    return defaults;
  }

  function setBackgroundEnabled(enabled) {
    saveBackgroundSettings({ enabled: !!enabled });
    if (!enabled) {
      clearBackgroundImage();
      if (shouldApplyThemeSkin() && isEpisodePath()) {
        document.documentElement.classList.add(CLS_ROOM, CLS_ACTIVE);
        decorateLayout();
      }
    } else if (!shouldApplyThemeSkin()) {
      clearThemeSkin();
    }
  }

  function isBackgroundEnabled() {
    return !!CONFIG.enabled;
  }

  function shouldApplyThemeSkin() {
    // 이 확프는 다크모드 전용.
    // 라이트모드에서는 배경/말풍선/입력창/라존데 스킨을 전부 꺼서 순정 UI로 둔다.
    // 단, '배경 이미지 보기' 토글은 이제 이미지 레이어만 끄고 UI 테마/글자 설정은 유지한다.
    return !CONFIG.darkModeOnly || isDarkTheme();
  }

  function markSettingsAdjusting() {
    document.documentElement.setAttribute('data-sgb-adjusting', 'true');
    clearTimeout(state.settingsAdjustTimer);
    state.settingsAdjustTimer = setTimeout(() => {
      document.documentElement.removeAttribute('data-sgb-adjusting');
    }, 180);
  }

  function formatSettingValue(key, value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    if (key === 'blurPx') return `${Math.round(n)}px`;
    if (key === 'imageOpacity' || key === 'dim' || key === 'uiOpacity') return `${Math.round(n * 100)}%`;
    if (key === 'scale') return `${Math.round(n * 100)}%`;
    if (key === 'brightness') return `${Math.round(n * 100)}%`;
    if (key === 'textScale' || key === 'codeTextScale') return `${Math.round(n * 100)}%`;
    if (key === 'fontWeight') return String(Math.round(n));
    if (key === 'lineHeight') return `${n.toFixed(2)}배`;
    if (key === 'letterSpacing') return `${n.toFixed(2)}em`;
    if (key === 'paragraphSpacing') return `${n.toFixed(2)}rem`;
    return String(n);
  }

  function isEpisodePath(pathname = location.pathname) {
    return /\/stories\/[^/]+\/episodes\/[^/?#]+/.test(pathname)
      || /\/episodes\/[^/?#]+/.test(pathname);
  }

  function isStrictCrackStoryEpisodeUrl() {
    return location.origin === 'https://crack.wrtn.ai'
      && /^\/stories\/[^/]+\/episodes\/[^/?#]+/.test(location.pathname);
  }

  function removeSettingsRowIfOutsideStrictEpisode() {
    if (isStrictCrackStoryEpisodeUrl()) return false;
    document.querySelectorAll(`#${SGB_UI_IDS.row}, [data-sgb-settings-row]`).forEach(el => el.remove());
    return true;
  }

  function getRoomId(pathname = location.pathname) {
    const match1 = pathname.match(/\/stories\/[^/]+\/episodes\/([^/?#]+)/);
    if (match1) return match1[1];

    const match2 = pathname.match(/\/episodes\/([^/?#]+)/);
    if (match2) return match2[1];

    return '';
  }

  function getSceneRecordsKey(roomId) {
    return `${CSP_PREFIX}_scene_records_${roomId}`;
  }

  function getSceneRecords(roomId) {
    if (!roomId) return {};

    const key = getSceneRecordsKey(roomId);
    const raw = localStorage.getItem(key);
    const cache = state.__sgbSceneRecordsCache;
    if (cache && cache.key === key && cache.raw === raw) return cache.records;

    const parsed = safeJsonParse(raw, {});
    const records = parsed && typeof parsed === 'object' ? parsed : {};
    state.__sgbSceneRecordsCache = { key, raw, records };
    return records;
  }

  function clampHistoryIndex(record) {
    const history = Array.isArray(record?.history) ? record.history : [];
    if (!history.length) return 0;

    const n = Number(record.currentIndex);
    if (!Number.isFinite(n)) return history.length - 1;

    return Math.max(0, Math.min(Math.trunc(n), history.length - 1));
  }

  function getRecordCurrentItem(record) {
    if (!record || typeof record !== 'object') return null;

    const history = Array.isArray(record.history)
      ? record.history.filter(item => item && (item.imageId || item.imageUrl))
      : [];

    if (history.length) {
      const item = history[clampHistoryIndex(record)] || history[history.length - 1];
      return {
        imageId: String(item?.imageId || '').trim(),
        imageUrl: String(item?.imageUrl || '').trim(),
        createdAt: Number(item?.createdAt || record.updatedAt || record.createdAt || 0) || 0
      };
    }

    if (record.imageId || record.imageUrl) {
      return {
        imageId: String(record.imageId || '').trim(),
        imageUrl: String(record.imageUrl || '').trim(),
        createdAt: Number(record.updatedAt || record.createdAt || 0) || 0
      };
    }

    return null;
  }

  function collectRecordCandidates(roomId) {
    const records = getSceneRecords(roomId);
    const candidates = [];

    Object.entries(records).forEach(([messageKey, record]) => {
      const item = getRecordCurrentItem(record);
      if (!item) return;
      if (!item.imageId && !item.imageUrl) return;

      candidates.push({
        type: 'record',
        messageKey,
        src: item.imageUrl,
        imageId: item.imageId,
        createdAt: item.createdAt,
        signature: `record:${messageKey}:${item.imageId || item.imageUrl.slice(0, 120)}:${item.createdAt}`
      });
    });

    candidates.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return String(a.messageKey).localeCompare(String(b.messageKey));
    });

    return candidates;
  }

  function getImageSrc(img) {
    return String(img?.currentSrc || img?.src || img?.getAttribute?.('src') || '').trim();
  }

  function isUsableImageSrc(src) {
    if (!src) return false;
    if (src === 'about:blank') return false;
    return src.startsWith('data:') || src.startsWith('blob:') || /^https?:\/\//i.test(src);
  }

  function viewportIntersectionScore(el) {
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 1;
    const vh = window.innerHeight || document.documentElement.clientHeight || 1;
    const margin = Math.max(0, Number(CONFIG.imageDetectMarginPx) || 0);

    if (rect.width < 40 || rect.height < 40) return 0;

    // 기존에는 실제 화면 안에 들어온 이미지만 후보가 됐음.
    // 이제 화면 주변으로 아주 살짝 여유 범위를 둬서,
    // 위/아래에 가까이 있는 이미지도 현재 맥락 이미지로 인식하게 한다.
    const left = Math.max(-margin, rect.left);
    const right = Math.min(vw + margin, rect.right);
    const top = Math.max(-margin, rect.top);
    const bottom = Math.min(vh + margin, rect.bottom);

    const visibleWidth = Math.max(0, right - left);
    const visibleHeight = Math.max(0, bottom - top);
    const visibleArea = visibleWidth * visibleHeight;

    if (visibleArea <= 0) return 0;

    const ownArea = Math.max(1, rect.width * rect.height);
    const viewportArea = Math.max(1, vw * vh);

    // margin으로만 잡힌 후보는 실제 화면 안 후보보다 살짝 약하게 본다.
    const intersectsRealViewport =
      rect.right > 0 && rect.left < vw && rect.bottom > 0 && rect.top < vh;
    const marginPenalty = intersectsRealViewport ? 1 : 0.72;

    return ((visibleArea / ownArea) * 1000 + (visibleArea / viewportArea) * 100) * marginPenalty;
  }

  function findBestVisibleDomImage(roomId) {
    const records = getSceneRecords(roomId);
    const recordKeys = new Set(Object.keys(records || {}));

    const images = Array.from(document.querySelectorAll('main .csp-generated-scene-image img[src]'))
      .filter(img => img instanceof HTMLImageElement)
      .map((img, index) => {
        const src = getImageSrc(img);
        const box = img.closest('.csp-generated-scene-image');
        const messageKey = String(box?.getAttribute('data-message-key') || '').trim();

        return {
          type: 'dom',
          img,
          src,
          messageKey,
          index,
          score: viewportIntersectionScore(img),
          signature: `dom:${messageKey}:${src.slice(0, 160)}:${src.length}`
        };
      })
      .filter(item => isUsableImageSrc(item.src))
      .filter(item => !recordKeys.size || !item.messageKey || recordKeys.has(item.messageKey));

    if (!images.length) return null;

    const visible = images.filter(item => item.score > 0);

    if (visible.length) {
      visible.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return a.index - b.index;
      });
      return visible[visible.length - 1];
    }

    // 화면 밖이면 DOM상 마지막 생성 이미지를 사용.
    return images[images.length - 1];
  }

  function openImageDb() {
    if (!window.indexedDB) return Promise.resolve(null);
    if (state.dbPromise) return state.dbPromise;

    state.dbPromise = new Promise(resolve => {
      let req;
      try {
        req = indexedDB.open(IMAGE_DB_NAME);
      } catch (err) {
        console.warn(`[${SCRIPT_NAME}] IndexedDB open failed:`, err);
        resolve(null);
        return;
      }

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => {
        console.warn(`[${SCRIPT_NAME}] IndexedDB open error:`, req.error);
        resolve(null);
      };
      req.onblocked = () => resolve(null);
    });

    return state.dbPromise;
  }

  async function readStoredImage(imageId) {
    if (!imageId) return '';

    const db = await openImageDb();
    if (!db || !db.objectStoreNames?.contains?.(IMAGE_STORE_NAME)) return '';

    return await new Promise(resolve => {
      let tx;
      try {
        tx = db.transaction(IMAGE_STORE_NAME, 'readonly');
      } catch (err) {
        console.warn(`[${SCRIPT_NAME}] IndexedDB transaction failed:`, err);
        resolve('');
        return;
      }

      const req = tx.objectStore(IMAGE_STORE_NAME).get(imageId);
      req.onsuccess = () => resolve(String(req.result?.dataUrl || ''));
      req.onerror = () => {
        console.warn(`[${SCRIPT_NAME}] IndexedDB image read failed:`, req.error);
        resolve('');
      };
    });
  }

  async function resolveRecordCandidate(candidate) {
    if (!candidate) return null;
    if (isUsableImageSrc(candidate.src)) return candidate;

    if (candidate.imageId) {
      const src = await readStoredImage(candidate.imageId);
      if (isUsableImageSrc(src)) {
        return {
          ...candidate,
          src,
          signature: `record-db:${candidate.messageKey}:${candidate.imageId}:${src.length}`
        };
      }
    }

    return null;
  }

  async function findBestImageForRoom(roomId) {
    // 1순위: 현재 화면에 실제로 보이는 Scene Painter 이미지.
    // 리롤 히스토리 이동으로 src가 바뀌면 이 값이 바로 바뀐다.
    const domCandidate = findBestVisibleDomImage(roomId);
    if (domCandidate?.src) return domCandidate;

    // 2순위: 방별 저장 기록 currentIndex.
    const records = collectRecordCandidates(roomId);
    for (let i = records.length - 1; i >= 0; i--) {
      const resolved = await resolveRecordCandidate(records[i]);
      if (resolved?.src) return resolved;
    }

    return null;
  }

  function getLayerBoundsRect() {
    const main = document.querySelector('main');
    if (!isEpisodePath() || !(main instanceof HTMLElement)) return null;

    const rect = main.getBoundingClientRect();
    if (!rect || rect.width < 80 || rect.height < 120) return null;

    return {
      left: Math.max(0, Number(rect.left) || 0),
      top: Math.max(0, Number(rect.top) || 0),
      width: Math.max(1, Number(rect.width) || main.clientWidth || 1),
      height: Math.max(1, Number(rect.height) || main.clientHeight || 1)
    };
  }

  function applyLayerBounds(root) {
    if (!(root instanceof HTMLElement)) return;

    const bounds = getLayerBoundsRect();
    const key = bounds
      ? `m:${Math.round(bounds.left)},${Math.round(bounds.top)},${Math.round(bounds.width)},${Math.round(bounds.height)}`
      : 'viewport';

    // 좌표가 이전과 같으면 inline 스타일 재작성을 생략한다.
    if (root.dataset.sgbBoundsKey === key) return;
    root.dataset.sgbBoundsKey = key;

    if (bounds) {
      root.style.setProperty('position', 'fixed', 'important');
      root.style.setProperty('inset', 'auto', 'important');
      root.style.setProperty('left', `${bounds.left}px`, 'important');
      root.style.setProperty('top', `${bounds.top}px`, 'important');
      root.style.setProperty('right', 'auto', 'important');
      root.style.setProperty('bottom', 'auto', 'important');
      root.style.setProperty('width', `${bounds.width}px`, 'important');
      root.style.setProperty('height', `${bounds.height}px`, 'important');
      root.setAttribute('data-sgb-bounds', 'main');
      return;
    }

    root.style.setProperty('position', 'fixed', 'important');
    root.style.setProperty('inset', '0', 'important');
    root.style.setProperty('top', '0', 'important');
    root.style.setProperty('right', '0', 'important');
    root.style.setProperty('bottom', '0', 'important');
    root.style.setProperty('left', '0', 'important');
    root.style.setProperty('width', '100vw', 'important');
    root.style.setProperty('height', '100vh', 'important');
    root.setAttribute('data-sgb-bounds', 'viewport');
  }

  function stabilizeLayerRoot(root) {
    if (!(root instanceof HTMLElement)) return;

    applyLayerBounds(root);

    // 위치 외 고정 속성은 최초 1회만 박아둔다.
    if (root.dataset.sgbStabilized === '1') return;
    root.dataset.sgbStabilized = '1';

    root.style.setProperty('z-index', '0', 'important');
    root.style.setProperty('pointer-events', 'none', 'important');
    root.style.setProperty('user-select', 'none', 'important');
    root.style.setProperty('overflow', 'hidden', 'important');
    root.style.setProperty('margin', '0', 'important');
    root.style.setProperty('padding', '0', 'important');
    root.style.setProperty('min-width', '0', 'important');
    root.style.setProperty('min-height', '0', 'important');
    root.style.setProperty('max-width', 'none', 'important');
    root.style.setProperty('max-height', 'none', 'important');
    root.style.setProperty('flex', '0 0 auto', 'important');
    root.style.setProperty('display', 'block', 'important');
  }

  function getEriRouteHoldMs() {
    return Math.max(900, Number(CONFIG.eriRouteHoldMs) || 3200);
  }

  function shouldHoldLayerForEriRoute() {
    if (!CONFIG.eriCompatibilityEnabled) return false;
    if (!isChatLikePathForEri()) return false;
    if (!state.routeHoldUntil || Date.now() > state.routeHoldUntil) return false;
    if (hasEriVisibleMenuButton()) return false;
    if (document.getElementById('lore-inj-boot-error')) return false;
    return true;
  }

  function parkLayerDuringEriRouteHold(root) {
    if (!(root instanceof HTMLElement)) return root;

    // SPA로 방끼리 이동하는 직후에는 로어 인젝터가 상단 버튼을 먼저 붙이도록
    // 배경 루트를 main 밖에 잠깐 주차하고 숨긴다. main의 첫 자식 구조를 건드리지 않기 위한 호환 장치.
    if (root.parentElement !== document.body && document.body) {
      document.body.prepend(root);
    }

    root.setAttribute('data-sgb-eri-route-hold', 'true');
    root.style.setProperty('display', 'none', 'important');
    root.style.setProperty('opacity', '0', 'important');
    return root;
  }

  function releaseLayerRouteHold(root) {
    if (!(root instanceof HTMLElement)) return;
    root.removeAttribute('data-sgb-eri-route-hold');
    root.style.removeProperty('display');
    root.style.removeProperty('opacity');
  }

  function ensureLayer() {
    const main = document.querySelector('main');
    let root = document.getElementById(IDS.root);

    if (main instanceof HTMLElement) {
      if (!main.hasAttribute('data-sgb-main-host')) main.setAttribute('data-sgb-main-host', '');
    }

    if (root) {
      stabilizeLayerRoot(root);

      if (shouldHoldLayerForEriRoute()) {
        return parkLayerDuringEriRouteHold(root);
      }

      releaseLayerRouteHold(root);

      if (main instanceof HTMLElement && root.parentElement !== main) {
        main.prepend(root);
      } else if (!(main instanceof HTMLElement) && document.body && root.parentElement !== document.body) {
        document.body.prepend(root);
      }

      return root;
    }

    root = document.createElement('div');
    root.id = IDS.root;
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
      <img id="${IDS.bg}" alt="">
      <div id="${IDS.dim}"></div>
    `;

    stabilizeLayerRoot(root);

    if (shouldHoldLayerForEriRoute()) {
      if (document.body) document.body.prepend(root);
      return parkLayerDuringEriRouteHold(root);
    }

    if (main instanceof HTMLElement) main.prepend(root);
    else document.body.prepend(root);

    return root;
  }

  function applyCssVars() {
    const root = ensureLayer();
    const cssVarsKey = JSON.stringify(normalizeBackgroundSettings(CONFIG));
    if (
      state.__sgbCssVarsKey === cssVarsKey &&
      state.__sgbCssVarsRoot === root &&
      document.documentElement.getAttribute('data-sgb-ui-style')
    ) {
      return;
    }
    state.__sgbCssVarsKey = cssVarsKey;
    state.__sgbCssVarsRoot = root;

    const targets = [document.documentElement, root].filter(Boolean);

    targets.forEach(target => {
      target.style.setProperty('--sgb-image-opacity', String(CONFIG.imageOpacity));
      target.style.setProperty('--sgb-blur', `${CONFIG.blurPx}px`);
      target.style.setProperty('--sgb-scale', String(CONFIG.scale));
      const darkenFactor = Math.max(0.20, 1 - (Number(CONFIG.dim) || 0) * 0.86);
      const effectiveBrightness = Math.max(0.12, (Number(CONFIG.brightness) || 0.82) * darkenFactor);
      const dimOverlay = Math.max(0, Math.min(0.18, (Number(CONFIG.dim) || 0) * 0.18));

      target.style.setProperty('--sgb-dim', String(CONFIG.dim));
      target.style.setProperty('--sgb-dim-overlay', String(dimOverlay));
      target.style.setProperty('--sgb-saturate', String(CONFIG.saturate));
      target.style.setProperty('--sgb-brightness', String(CONFIG.brightness));
      target.style.setProperty('--sgb-effective-brightness', String(effectiveBrightness));
      target.style.setProperty('--sgb-object-fit', CONFIG.objectFit || 'contain');
      target.style.setProperty('--sgb-object-position', CONFIG.objectPosition || 'center center');
      const uiOpacity = Math.max(0.18, Math.min(1, Number(CONFIG.uiOpacity) || 0.86));
      const opacityRate = Math.max(0, Math.min(1, (uiOpacity - 0.18) / 0.82));
      const uiGlassBlur = Math.round(2 + (1 - opacityRate) * 22);
      target.style.setProperty('--sgb-ui-opacity', String(uiOpacity));
      target.style.setProperty('--sgb-ui-soft-alpha', String(0.16 + opacityRate * 0.22));
      target.style.setProperty('--sgb-ui-medium-alpha', String(0.22 + opacityRate * 0.30));
      target.style.setProperty('--sgb-ui-strong-alpha', String(0.36 + opacityRate * 0.42));
      target.style.setProperty('--sgb-glass-blur', `${uiGlassBlur}px`);
      target.style.setProperty('--sgb-theme-surface-alpha', String(uiOpacity));
      target.style.setProperty('--sgb-input-bottom', `${CONFIG.inputBottomPaddingPx}px`);
      target.style.setProperty('--sgb-chat-light-alpha', String(CONFIG.chatBubbleOpacityLight));
      target.style.setProperty('--sgb-chat-dark-alpha', String(CONFIG.chatBubbleOpacityDark));

      target.style.setProperty('--sgb-readable-text', CONFIG.textColor || '#fafafa');
      target.style.setProperty('--sgb-muted-text', CONFIG.emColor || '#85837d');
      target.style.setProperty('--sgb-strong-text', CONFIG.strongColor || '#fafafa');
      target.style.setProperty('--sgb-italic-text', CONFIG.italicTextColor || CONFIG.emColor || '#84827e');
      target.style.setProperty('--sgb-strong-highlight-text', CONFIG.strongBgTextColor || CONFIG.strongColor || '#fafafa');
      target.style.setProperty('--sgb-text-scale', String(Math.max(0.80, Math.min(1.20, Number(CONFIG.textScale) || 1))));
      target.style.setProperty('--sgb-code-text-scale', String(Math.max(0.70, Math.min(1.20, Number(CONFIG.codeTextScale) || 1))));
      target.style.setProperty('--sgb-font-weight', String(Math.round(Math.max(300, Math.min(900, Number(CONFIG.fontWeight) || 400)) / 100) * 100));
      const customFontStack = cssFontStack(getEffectiveCustomFontFamily(CONFIG));
      if (customFontStack) target.style.setProperty('--sgb-custom-chat-font-stack', customFontStack);
      else target.style.removeProperty('--sgb-custom-chat-font-stack');
      target.style.setProperty('--sgb-line-height', String(Math.max(1.35, Math.min(2.10, Number(CONFIG.lineHeight) || 1.65))));
      target.style.setProperty('--sgb-letter-spacing', `${Math.max(-0.03, Math.min(0.08, Number(CONFIG.letterSpacing) || 0))}em`);
      target.style.setProperty('--sgb-paragraph-spacing', `${Math.max(0, Math.min(1.60, Number(CONFIG.paragraphSpacing) || 0))}rem`);
      target.style.setProperty('--sgb-dialogue-rgb', hexToRgbTriplet(CONFIG.dialogueBg, '178,154,166'));
      target.style.setProperty('--sgb-dialogue-text', CONFIG.dialogueTextColor || '#fdfbfc');
      target.style.setProperty('--sgb-thought-rgb', hexToRgbTriplet(CONFIG.thoughtBg, '168,154,166'));
      target.style.setProperty('--sgb-thought-text', CONFIG.thoughtTextColor || '#f4eef1');
      target.style.setProperty('--sgb-italic-rgb', hexToRgbTriplet(CONFIG.italicBg, '232,224,228'));
      target.style.setProperty('--sgb-strongbg-rgb', hexToRgbTriplet(CONFIG.strongBg, '240,224,232'));
      target.style.setProperty('--sgb-code-rgb', hexToRgbTriplet(CONFIG.codeAccent, '200,166,182'));
    });

    const shadowTone = normalizeTextShadowTone(CONFIG.textShadowTone);

    const activePaletteIndex = Math.max(0, Math.round(Number(CONFIG.uiPaletteIndex) || 0));
    const useBaseThemeColorCss = !!CONFIG.themeRecommendedColorsEnabled && activePaletteIndex === 0;

    document.documentElement.setAttribute('data-sgb-ui-style', normalizeUiStyle(CONFIG.uiStyle));
    document.documentElement.setAttribute('data-sgb-theme-colors', useBaseThemeColorCss ? 'on' : 'off');
    document.documentElement.setAttribute('data-sgb-theme-palette', CONFIG.themeRecommendedColorsEnabled ? String(activePaletteIndex) : 'custom');
    document.documentElement.setAttribute('data-sgb-text-shadow', CONFIG.textShadowEnabled ? 'on' : 'off');
    document.documentElement.setAttribute('data-sgb-text-shadow-tone', shadowTone);
    injectCustomFontStyle();
    document.documentElement.setAttribute('data-sgb-chat-font', getEffectiveCustomFontFamily(CONFIG) ? 'custom' : 'none');
    document.documentElement.setAttribute('data-sgb-dialogue-bg', CONFIG.dialogueBgEnabled ? 'on' : 'off');
    document.documentElement.setAttribute('data-sgb-thought-bg', CONFIG.thoughtBgEnabled ? 'on' : 'off');
    document.documentElement.setAttribute('data-sgb-italic-bg', CONFIG.italicBgEnabled ? 'on' : 'off');
    document.documentElement.setAttribute('data-sgb-strong-bg', CONFIG.strongBgEnabled ? 'on' : 'off');
    document.documentElement.setAttribute('data-sgb-code-bg', CONFIG.codeBlockBgEnabled ? 'on' : 'off');
    document.documentElement.setAttribute('data-sgb-markdown-decor', CONFIG.markdownDecorEnabled ? 'on' : 'off');
    document.documentElement.setAttribute('data-sgb-highlight-shape', normalizeHighlightShape(CONFIG.highlightShape));

    if (shadowTone === 'light') {
      // 흰색 그림자는 검정 그림자와 같은 강도로 쓰면 발광/블룸처럼 튀므로 훨씬 약하게.
      document.documentElement.style.setProperty('--sgb-text-shadow-rgb', '235, 240, 255');
      document.documentElement.style.setProperty('--sgb-text-shadow-a1', '.32');
      document.documentElement.style.setProperty('--sgb-text-shadow-a2', '.20');
      document.documentElement.style.setProperty('--sgb-text-shadow-a3', '.12');
    } else {
      document.documentElement.style.setProperty('--sgb-text-shadow-rgb', '0, 0, 0');
      document.documentElement.style.setProperty('--sgb-text-shadow-a1', '.78');
      document.documentElement.style.setProperty('--sgb-text-shadow-a2', '.56');
      document.documentElement.style.setProperty('--sgb-text-shadow-a3', '.34');
    }
  }

  function setBackgroundImage(candidate) {
    if (!candidate?.src) return;
    if (!CONFIG.enabled) {
      clearBackgroundImage();
      return;
    }
    if (!shouldApplyThemeSkin()) {
      clearBackgroundImage();
      return;
    }

    ensureLayer();
    applyCssVars();

    const img = document.getElementById(IDS.bg);
    if (img && state.currentSrc !== candidate.src) {
      img.setAttribute('src', candidate.src);
      state.currentSrc = candidate.src;
    }

    state.currentSignature = candidate.signature || `${candidate.type}:${candidate.src.length}`;

    document.documentElement.classList.add(CLS_ROOM, CLS_ACTIVE, CLS_IMAGE_ACTIVE);
    document.documentElement.setAttribute('data-sgb-source', candidate.type || '');

    decorateLayout();

    if (document.scrollingElement && document.scrollingElement.scrollTop > 0) {
      // Crack의 실제 채팅 스크롤은 내부 scroller라서 window scrollTop은 0이어야 정상.
      // 배경 레이어가 새는 경우 생기는 가짜 페이지 스크롤만 즉시 원위치.
      document.scrollingElement.scrollTop = 0;
    }

    log('background applied', candidate.type, candidate.messageKey || '', candidate.src.slice(0, 80));
  }

  function clearBackgroundImage() {
    const img = document.getElementById(IDS.bg);
    if (img) img.removeAttribute('src');

    state.currentSrc = '';
    state.currentSignature = '';

    document.documentElement.classList.remove(CLS_IMAGE_ACTIVE);
    document.documentElement.removeAttribute('data-sgb-source');
  }

  function clearThemeSkin() {
    clearBackgroundImage();

    document.documentElement.classList.remove(CLS_ACTIVE, CLS_ROOM, CLS_IMAGE_ACTIVE);
    document.documentElement.removeAttribute('data-sgb-source');

    // 다크모드/방 이탈/라이트모드에서 붙었던 전용 마커 정리.
    document.querySelectorAll('[data-sgb-radiosonde-skin], [data-sgb-radiosonde-head], [data-sgb-radiosonde-barline], [data-sgb-radiosonde-part]').forEach(el => {
      if (!(el instanceof HTMLElement)) return;
      el.removeAttribute('data-sgb-radiosonde-skin');
      el.removeAttribute('data-sgb-radiosonde-head');
      el.removeAttribute('data-sgb-radiosonde-barline');
      el.removeAttribute('data-sgb-radiosonde-part');
    });

    restoreLargeBackgroundPanels();
  }

  function parseCssRgb(value) {
    const match = String(value || '').match(/rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)(?:,\s*(\d+(?:\.\d+)?))?\)/i);
    if (!match) return null;

    const alpha = match[4] === undefined ? 1 : Number(match[4]);
    if (!Number.isFinite(alpha) || alpha <= 0.04) return null;

    return [Number(match[1]), Number(match[2]), Number(match[3]), alpha];
  }

  function getColorLuminance(rgb) {
    if (!rgb) return null;

    const convert = c => {
      const n = c / 255;
      return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
    };

    return 0.2126 * convert(rgb[0]) + 0.7152 * convert(rgb[1]) + 0.0722 * convert(rgb[2]);
  }

  function resolveCssVarColor(varName, property = 'backgroundColor') {
    const probe = document.createElement('span');
    probe.style.cssText = [
      'position:fixed',
      'left:-9999px',
      'top:-9999px',
      'width:1px',
      'height:1px',
      'pointer-events:none',
      'visibility:hidden'
    ].join(';');

    if (property === 'color') {
      probe.style.color = `var(${varName})`;
    } else {
      probe.style.backgroundColor = `var(${varName})`;
    }

    document.documentElement.appendChild(probe);
    const value = property === 'color'
      ? getComputedStyle(probe).color
      : getComputedStyle(probe).backgroundColor;
    probe.remove();

    return parseCssRgb(value);
  }

  function computeIsDarkTheme() {
    const html = document.documentElement;
    const body = document.body;
    const hints = [
      html.getAttribute('data-theme'),
      html.getAttribute('data-color-mode'),
      html.getAttribute('class'),
      body?.getAttribute('data-theme'),
      body?.getAttribute('data-color-mode'),
      body?.getAttribute('class'),
      document.querySelector('#__next')?.getAttribute('class')
    ].join(' ').toLowerCase();

    if (/\bdark\b|theme-dark|dark-mode|darkmode|color-scheme-dark/.test(hints)) return true;
    if (/\blight\b|theme-light|light-mode|lightmode|color-scheme-light/.test(hints)) return false;

    // 다크모드에서 입력창/말풍선이 하얘지던 원인:
    // 기존 코드는 배경 변수(--bg_screen 등)를 먼저 보고 light로 오판하는 경우가 있었다.
    // 텍스트 색이 밝으면 다크모드로 보는 쪽이 Crack UI에서는 더 안정적이다.
    const textVars = ['--text_primary', '--foreground', '--text-primary', '--text', '--line-gray-1'];
    for (const varName of textVars) {
      const rgb = resolveCssVarColor(varName, 'color');
      const lum = getColorLuminance(rgb);
      if (lum !== null) {
        if (lum > 0.58) return true;
        if (lum < 0.42) return false;
      }
    }

    const bgVars = ['--bg_screen', '--background', '--bg-background', '--surface_primary', '--surface', '--card'];
    for (const varName of bgVars) {
      const rgb = resolveCssVarColor(varName, 'backgroundColor');
      const lum = getColorLuminance(rgb);
      if (lum !== null) {
        if (lum < 0.45) return true;
        if (lum > 0.78) return false;
      }
    }

    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches || false;
  }
  function applyTheme() {
    const next = isDarkTheme() ? 'dark' : 'light';
    if (document.documentElement.getAttribute('data-sgb-theme') !== next) {
      document.documentElement.setAttribute('data-sgb-theme', next);
    }
  }

  function isDarkTheme() {
    const now = Date.now();
    if (state.__sgbDarkCacheAt && (now - state.__sgbDarkCacheAt) < 4000) {
      return !!state.__sgbDarkCache;
    }
    const value = computeIsDarkTheme();
    state.__sgbDarkCache = value;
    state.__sgbDarkCacheAt = now;
    return value;
  }

  function updateRoomClass() {
    const inRoom = isEpisodePath();

    document.documentElement.classList.toggle(CLS_ROOM, inRoom);

    if (!inRoom) {
      clearThemeSkin();
      return false;
    }

    return true;
  }

  async function refreshNow(reason = 'manual') {
    // 실행 중이면 겹쳐 돌리지 않고, 끝난 뒤 한 번만 다시 돈다.
    if (state.__sgbRefreshBusy) {
      state.__sgbRefreshPendingReason = reason;
      return;
    }
    state.__sgbRefreshBusy = true;

    try {
      applyTheme();

      if (!shouldApplyThemeSkin()) {
        clearThemeSkin();
        log('dark-only disabled in light mode', reason);
        return;
      }

      ensureLayer();
      applyCssVars();

      if (!updateRoomClass()) return;

      const roomId = getRoomId();
      if (!roomId) {
        clearThemeSkin();
        return;
      }

      if (roomId !== state.roomId) {
        state.roomId = roomId;
        clearBackgroundImage();
      }

      document.documentElement.classList.add(CLS_ROOM, CLS_ACTIVE);
      decorateLayout();

      // '배경 이미지 보기'가 꺼져 있으면 이미지 레이어만 비우고,
      // UI 테마/글라스/글자색/글자 그림자는 그대로 유지한다.
      if (!CONFIG.enabled) {
        clearBackgroundImage();
        return;
      }

      const candidate = await findBestImageForRoom(roomId);
      if (!candidate?.src) {
        clearBackgroundImage();
        log('no image', reason);
        return;
      }

      const signature = candidate.signature || `${candidate.type}:${candidate.src.length}`;
      if (signature === state.currentSignature && state.currentSrc === candidate.src && document.documentElement.classList.contains(CLS_IMAGE_ACTIVE)) {
        return;
      }

      setBackgroundImage(candidate);
    } finally {
      state.__sgbRefreshBusy = false;

      const pending = state.__sgbRefreshPendingReason;
      state.__sgbRefreshPendingReason = '';
      if (pending) scheduleRefresh(pending, 0);
    }
  }

  function scheduleRefresh(reason = 'scheduled', delay = 120) {
    const guardPanel = delay > 0;
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      if (guardPanel && isCrackNativePanelOpen()) return;
      refreshNow(reason).catch(err => console.warn(`[${SCRIPT_NAME}] refresh failed:`, err));
    }, Math.max(0, Number(delay) || 0));
  }

  function scheduleRefreshBurst(reason = 'burst') {
    for (const ms of CONFIG.refreshAfterClickMs) {
      setTimeout(() => scheduleRefresh(reason, 0), ms);
    }
  }

  function getNativeSettingsRowCandidate(el) {
    if (!(el instanceof HTMLElement)) return null;
    const row = el.closest('div[class*="px-2.5"][class*="py-[18px]"], div[class*="px-2.5"][class*="box-content"], div[class*="py-[18px]"][class*="h-4"]');
    if (row instanceof HTMLElement) return row;

    for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) {
      if (!(cur instanceof HTMLElement)) continue;
      const cls = String(cur.className || '');
      if (
        cls.includes('px-2.5') ||
        (cls.includes('box-content') && cls.includes('h-4')) ||
        cls.includes('py-[18px]')
      ) {
        return cur;
      }
    }

    return el.closest('div');
  }

  function getNativeSettingsRowText(el) {
    return String(el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isOwnSettingsUiElement(el) {
    return !!(el instanceof Element && el.closest(`#${SGB_UI_IDS.row}, [data-sgb-settings-row], #${SGB_UI_IDS.modal}`));
  }

  function isSettingsAnchorRow(row) {
    if (!(row instanceof HTMLElement)) return false;
    if (isOwnSettingsUiElement(row)) return false;
    const text = getNativeSettingsRowText(row);
    return /키보드\s*단축키|상황\s*이미지\s*보기|이미지\s*보관함|플레이\s*가이드|대화\s*프로필|유저\s*노트|최대\s*출력량\s*조절|요약\s*메모리|글꼴/.test(text);
  }

  function findKeyboardShortcutRow() {
    // Whale/Chromium 계열에서는 메뉴 항목이 <button>이 아니라 <div role="button">로 렌더될 수 있다.
    // 그래서 텍스트 앵커를 넓게 잡고, row 후보는 px-2.5/py-[18px]/box-content 조합으로 찾는다.
    const anchorLabels = [
      /키보드\s*단축키/,
      /상황\s*이미지\s*보기/,
      /이미지\s*보관함/,
      /플레이\s*가이드/,
      /대화\s*프로필/,
      /유저\s*노트/,
      /최대\s*출력량\s*조절/,
      /요약\s*메모리/,
      /글꼴/
    ];

    const controls = Array.from(document.querySelectorAll('button, [role="button"], a, [tabindex]'));
    for (const labelRe of anchorLabels) {
      const target = controls.find(el => {
        if (!(el instanceof HTMLElement)) return false;
        if (isOwnSettingsUiElement(el)) return false;
        return labelRe.test(getNativeSettingsRowText(el));
      });

      const row = getNativeSettingsRowCandidate(target);
      if (row instanceof HTMLElement && row.parentElement && isSettingsAnchorRow(row)) return row;
    }

    // fallback: label span만 잡힌 경우에도 부모 row를 찾아 붙인다.
    const labels = Array.from(document.querySelectorAll('span.whitespace-nowrap, span[class*="typo-text-sm"], span'));
    for (const labelRe of anchorLabels) {
      const label = labels.find(el => el instanceof HTMLElement && !isOwnSettingsUiElement(el) && labelRe.test(getNativeSettingsRowText(el)));
      const row = getNativeSettingsRowCandidate(label);
      if (row instanceof HTMLElement && row.parentElement && isSettingsAnchorRow(row)) return row;
    }

    // 최후 fallback: 채팅방 설정/전체 설정 근처의 메뉴 row 중 마지막 후보에 붙인다.
    const rows = Array.from(document.querySelectorAll('div[class*="px-2.5"][class*="py-[18px]"], div[class*="px-2.5"][class*="box-content"]'))
      .filter(el => el instanceof HTMLElement && el.parentElement && !isOwnSettingsUiElement(el) && isSettingsAnchorRow(el));

    return rows.length ? rows[rows.length - 1] : null;
  }

  function createSettingsRow() {
    const row = document.createElement('div');
    row.id = SGB_UI_IDS.row;
    row.className = 'px-2.5 h-4 box-content py-[18px]';
    row.setAttribute('data-sgb-settings-row', '');

    row.innerHTML = `
      <div role="button" tabindex="0" class="w-full flex h-4 items-center justify-between typo-text-base_leading-none_medium space-x-2 [&_svg]:fill-icon_tertiary ring-offset-4 ring-offset-sidebar cursor-pointer" data-sgb-settings-open>
        <span class="flex space-x-2 items-center min-w-0">
          <svg xmlns="http://www.w3.org/2000/svg" fill="var(--icon_secondary)" viewBox="0 0 24 24" width="24" height="24" color="icon_secondary">
            <path d="m11.7 6.08 6.36 3.67-6.36 3.67z"></path>
            <path fill-rule="evenodd" d="M6.71 3.91c0-.94.76-1.7 1.7-1.7H20.1c.94 0 1.7.76 1.7 1.7V15.6c0 .94-.76 1.7-1.7 1.7h-2.81v2.8c0 .94-.76 1.7-1.7 1.7H3.9a1.7 1.7 0 0 1-1.7-1.7V8.41c0-.94.76-1.7 1.7-1.7h2.81zm1.7-.1a.1.1 0 0 0-.1.1V15.6q0 .1.1.1H20.1a.1.1 0 0 0 .1-.1V3.91a.1.1 0 0 0-.1-.1zm0 13.49h7.28v2.8a.1.1 0 0 1-.1.1H3.9a.1.1 0 0 1-.1-.1V8.41q0-.1.1-.1h2.81v7.29c0 .94.76 1.7 1.7 1.7" clip-rule="evenodd"></path>
          </svg>
          <span class="whitespace-nowrap overflow-hidden text-ellipsis typo-text-sm_leading-none_medium">배경 이미지 보기</span>
        </span>
        <span data-sgb-toggle-wrap>
          <button type="button" role="switch" aria-checked="true" data-state="checked" value="on" class="peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border data-[state=unchecked]:border-bg-input-80 data-[state=unchecked]:bg-bg-input-80 data-[state=checked]:border-primary data-[state=checked]:bg-primary focus-visible:border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50" tabindex="-1" data-sgb-toggle-switch>
            <span data-state="checked" class="pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-[15px] data-[state=unchecked]:translate-x-[-1px]" data-sgb-toggle-thumb></span>
          </button>
        </span>
      </div>
    `;

    row.querySelector('[data-sgb-settings-open]')?.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest?.('[data-sgb-toggle-switch], [data-sgb-toggle-wrap]')) {
        event.preventDefault();
        event.stopPropagation();
        setBackgroundEnabled(!CONFIG.enabled);
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openSettingsModal();
    });

    row.querySelector('[data-sgb-settings-open]')?.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      openSettingsModal();
    });

    return row;
  }

  function decorateSettingsRow() {
    // 메뉴 버튼은 https://crack.wrtn.ai/stories/*/episodes/* 에서만 노출한다.
    if (removeSettingsRowIfOutsideStrictEpisode()) return;

    // 빠른 경로: 이미 제자리에 붙어 있으면 사이드바 전체 재탐색을 생략한다.
    const fastRow = document.getElementById(SGB_UI_IDS.row);
    if (fastRow instanceof HTMLElement && fastRow.isConnected) {
      const prev = fastRow.previousElementSibling;
      if (isSettingsAnchorRow(prev)) {
        syncSettingsUi();
        return;
      }
    }

    const anchor = findKeyboardShortcutRow();
    if (!(anchor instanceof HTMLElement) || !anchor.parentElement) {
      syncSettingsUi();
      return;
    }

    const existingRow = document.getElementById(SGB_UI_IDS.row);
    if (existingRow instanceof HTMLElement) {
      if (existingRow.previousElementSibling !== anchor || existingRow.parentElement !== anchor.parentElement) {
        anchor.insertAdjacentElement('afterend', existingRow);
      }
      syncSettingsUi();
      return;
    }

    document.querySelectorAll('[data-sgb-settings-row]').forEach(el => el.remove());
    anchor.insertAdjacentElement('afterend', createSettingsRow());
    syncSettingsUi();
  }


  function scheduleSettingsRowDecorateBurst(reason = 'settings-menu') {
    // 채팅방 정규 URL 밖에서는 Whale/Chromium 재시도 타이머도 돌리지 않는다.
    if (removeSettingsRowIfOutsideStrictEpisode()) return;

    [0, 80, 260, 700, 1400].forEach(ms => {
      window.setTimeout(() => {
        try {
          decorateSettingsRow();
        } catch (err) {
          console.warn(`[${SCRIPT_NAME}] settings row decorate failed:`, err);
        }
      }, ms);
    });
  }

  function isPotentialNativeSettingsMenuTrigger(target) {
    if (!(target instanceof Element)) return false;
    if (isOwnSettingsUiElement(target)) return false;
    return !!target.closest('[class*="ring-offset-sidebar"], [role="button"], button, [aria-haspopup], [data-state], [data-radix-collection-item]');
  }

  function getSettingsDefinitions() {
    return [
      { key: 'blurPx', label: '배경 흐림', min: 0, max: 22, step: 1 },
      { key: 'dim', label: '배경 어둡게', min: 0, max: 0.78, step: 0.01 },
      { key: 'scale', label: '이미지 확대/축소', min: 0.86, max: 1.28, step: 0.01 },
      { key: 'uiOpacity', label: 'UI 불투명도', min: 0.18, max: 1, step: 0.01 }
    ];
  }

  function getColorSettingDefinitions() {
    return [
      { key: 'textColor', label: '본문 글자색' },
      { key: 'emColor', label: '묘사 글자색' },
      { key: 'strongColor', label: '강조 글자색' }
    ];
  }

  function createSettingsModal() {
    const modal = document.createElement('div');
    modal.id = SGB_UI_IDS.modal;
    modal.setAttribute('data-sgb-settings-modal', '');
    modal.setAttribute('data-sgb-settings-layout', 'tabs-v14');

    const sliderTpl = (key, label, min, max, step) => `
      <label class="sgb-settings-control">
        <span class="sgb-settings-control-head">
          <span>${label}</span>
          <output data-sgb-setting-output="${key}">${formatSettingValue(key, CONFIG[key])}</output>
        </span>
        <input type="range" min="${min}" max="${max}" step="${step}" value="${CONFIG[key]}" data-sgb-setting-input="${key}">
      </label>
    `;

    const boolSwitchTpl = key => `
      <button
        type="button"
        role="switch"
        aria-checked="${CONFIG[key] ? 'true' : 'false'}"
        data-state="${CONFIG[key] ? 'checked' : 'unchecked'}"
        value="${CONFIG[key] ? 'on' : 'off'}"
        class="peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border data-[state=unchecked]:border-bg-input-80 data-[state=unchecked]:bg-bg-input-80 data-[state=checked]:border-primary data-[state=checked]:bg-primary focus-visible:border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50"
        tabindex="-1"
        data-sgb-bool-toggle="${key}"
      >
        <span
          data-state="${CONFIG[key] ? 'checked' : 'unchecked'}"
          class="pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-[15px] data-[state=unchecked]:translate-x-[-1px]"
          data-sgb-bool-thumb="${key}"
        ></span>
      </button>
    `;

    const colorRowTpl = (key, label, extraAttrs = '') => `
      <div class="sgb-color-control" ${extraAttrs}>
        <span class="sgb-color-label">${label}</span>
        <span class="sgb-color-control-inputs">
          <input type="color" value="${CONFIG[key]}" data-sgb-color-picker="${key}" aria-label="${label}">
          <input type="text" value="${CONFIG[key]}" spellcheck="false" data-sgb-color-code="${key}" aria-label="${label} 코드">
        </span>
      </div>
    `;

    const styleOptions = getUiStyleDefinitions().map(style => {
      const palettes = getUiStylePaletteDefinitions(style.value);
      const paletteChips = palettes.length > 1
        ? palettes.map((palette, index) => `
          <button
            type="button"
            class="sgb-style-chip ${index === 0 ? 'sgb-style-chip-base' : ''}"
            title="${style.label} · ${palette.label}"
            aria-label="${style.label} ${palette.label} 팔레트 적용"
            data-sgb-style-palette="${style.value}"
            data-sgb-palette-index="${index}"
            style="--sgb-chip-color:${palette.colors[0]};--sgb-chip-color-2:${palette.colors[1]};--sgb-chip-color-3:${palette.colors[2]}"
          ></button>
        `).join('')
        : '';

      return `
        <div class="sgb-style-option" data-sgb-ui-style-option="${style.value}" role="radio" tabindex="0" aria-checked="${CONFIG.uiStyle === style.value ? 'true' : 'false'}">
          <span class="sgb-style-line">
            <span class="sgb-style-name">${style.label}</span>
            <span class="sgb-style-palette" aria-label="${style.label} 색상 프리뷰">${paletteChips}</span>
          </span>
          <span class="sgb-style-desc">${style.desc}</span>
        </div>
      `;
    }).join('');

    const bgSliders = getSettingsDefinitions()
      .map(def => sliderTpl(def.key, def.label, def.min, def.max, def.step))
      .join('');

    const paneStyle = `
      <div class="sgb-pane" data-pane="style" data-selected="true">
        <div class="sgb-sub">UI 스타일</div>
        <div class="sgb-style-options" role="radiogroup" aria-label="UI 스타일">${styleOptions}</div>
        <div class="sgb-sub">배경 조절</div>
        ${bgSliders}
      </div>
    `;

    const colorControls = getColorSettingDefinitions()
      .map(def => colorRowTpl(def.key, def.label))
      .join('');

    const paneText = `
      <div class="sgb-pane" data-pane="text" data-selected="false">
        <label class="sgb-settings-enable sgb-settings-toggle-row">
          <span>
            <strong>테마 추천 색 적용</strong>
            <small>켜면 현재 UI 테마에 맞춘 추천 색, 끄면 아래 커스텀 색으로 돌아와요.</small>
          </span>
          ${boolSwitchTpl('themeRecommendedColorsEnabled')}
        </label>
        <div class="sgb-sub">글자색</div>
        ${colorControls}
        <div class="sgb-sub">글자 모양</div>
        <div class="sgb-settings-control sgb-font-direct">
          <span class="sgb-settings-control-head">
            <span>폰트</span>
            <output data-sgb-font-output>${getChatFontLabel(CONFIG)}</output>
          </span>
          <label class="sgb-font-field">
            <span>저장한 폰트</span>
            <select class="sgb-font-select" data-sgb-font-library>${renderFontLibraryOptions(CONFIG)}</select>
          </label>
          <div class="sgb-font-library-actions">
            <label class="sgb-font-file-button">
              로컬 폰트 추가
              <input type="file" accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf" data-sgb-local-font-file>
            </label>
            <button type="button" data-sgb-font-library-delete>선택 기록 삭제</button>
          </div>
          <label class="sgb-font-field">
            <span>웹폰트</span>
            <textarea spellcheck="false" rows="3" data-sgb-font-input="customFontCssUrl" placeholder="@font-face {...} / .woff2 URL / @import url(...)">${htmlTextareaValue(getCurrentFontSourceInput(CONFIG))}</textarea>
          </label>
          <label class="sgb-font-field">
            <span>폰트 종류</span>
            <select class="sgb-font-select" data-sgb-font-input="customFontFamily">${renderFontFamilyOptions(CONFIG)}</select>
          </label>
          <small class="sgb-font-help">입력한 웹폰트는 원문 그대로 브라우저에 저장되고 드롭다운에 기억돼요. 로컬 woff2·woff·ttf·otf 파일도 추가하면 새로고침 후 다시 선택할 수 있어요.</small>
        </div>
        ${sliderTpl('textScale', '글씨 크기', 0.80, 1.20, 0.01)}
        ${sliderTpl('codeTextScale', '코드블록 글씨 크기', 0.70, 1.20, 0.01)}
        ${sliderTpl('fontWeight', '폰트 두께', 300, 900, 100)}
        ${sliderTpl('lineHeight', '행간', 1.35, 2.10, 0.01)}
        ${sliderTpl('letterSpacing', '자간', -0.03, 0.08, 0.01)}
        ${sliderTpl('paragraphSpacing', '문단 간격', 0, 1.60, 0.01)}
        <div class="sgb-sub">그림자</div>
        <label class="sgb-settings-enable sgb-settings-toggle-row">
          <span>
            <strong>글자 그림자</strong>
            <small>글자를 또렷하게 보이도록 바깥쪽 그림자를 넣어요.</small>
          </span>
          ${boolSwitchTpl('textShadowEnabled')}
        </label>
        <div class="sgb-shadow-tone-control">
          <span class="sgb-shadow-tone-label">그림자 색</span>
          <div class="sgb-shadow-tone-options" role="radiogroup" aria-label="그림자 색">
            ${getTextShadowToneDefinitions().map(tone => `
              <button type="button" class="sgb-shadow-tone-option" data-sgb-shadow-tone="${tone.value}" role="radio" aria-checked="${CONFIG.textShadowTone === tone.value ? 'true' : 'false'}">
                ${tone.label}
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    const highlightColorDefs = getHighlightColorSettingDefinitions();
    const highlightCards = getHighlightToggleDefinitions().map(def => {
      const colorRows = highlightColorDefs
        .filter(colorDef => colorDef.when === def.key)
        .map(colorDef => colorRowTpl(
          colorDef.key,
          colorDef.label.replace(/^대사 |^생각 |^이탤릭 |^굵게 |^코드블록 /, ''),
          `data-sgb-highlight-color-row="${colorDef.key}" data-sgb-color-for="${def.key}"`
        ))
        .join('');

      return `
        <div class="sgb-hl-card">
          <div class="sgb-hl-top">
            <span><strong>${def.label}</strong><small>${def.desc}</small></span>
            ${boolSwitchTpl(def.key)}
          </div>
          ${colorRows ? `<div class="sgb-hl-colors">${colorRows}</div>` : ''}
        </div>
      `;
    }).join('');

    const paneHl = `
      <div class="sgb-pane" data-pane="hl" data-selected="false">
        ${highlightCards}
      </div>
    `;

    modal.innerHTML = `
      <section class="sgb-settings-panel" role="dialog" aria-modal="true" aria-label="배경 이미지 설정">
        <header class="sgb-settings-header">
          <div>
            <strong>배경 이미지 설정</strong>
            <p>현재 방의 상황 이미지를 배경으로 보여줘요.</p>
          </div>
          <button type="button" class="sgb-settings-close" aria-label="닫기" data-sgb-settings-close>×</button>
        </header>
        <label class="sgb-settings-enable">
          <span>배경 이미지 보기</span>
          <button type="button" role="switch" aria-checked="true" data-state="checked" value="on" class="peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border data-[state=unchecked]:border-bg-input-80 data-[state=unchecked]:bg-bg-input-80 data-[state=checked]:border-primary data-[state=checked]:bg-primary focus-visible:border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50" tabindex="-1" data-sgb-modal-toggle>
            <span data-state="checked" class="pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-[15px] data-[state=unchecked]:translate-x-[-1px]" data-sgb-modal-toggle-thumb></span>
          </button>
        </label>
        <div class="sgb-tabs" role="tablist">
          <button type="button" class="sgb-tab" data-sgb-tab="style" data-selected="true" role="tab">▦ 스타일</button>
          <button type="button" class="sgb-tab" data-sgb-tab="text" data-selected="false" role="tab">T 글자</button>
          <button type="button" class="sgb-tab" data-sgb-tab="hl" data-selected="false" role="tab">▰ 강조</button>
        </div>
        <div class="sgb-settings-body">
          ${paneStyle}
          ${paneText}
          ${paneHl}
        </div>
        <footer class="sgb-settings-footer">
          <button type="button" data-sgb-settings-reset>초기값</button>
          <button type="button" data-sgb-settings-close>닫기</button>
        </footer>
      </section>
    `;

    const commitRangeInput = (input, finalCommit = false) => {
      if (!(input instanceof HTMLInputElement)) return;
      const key = input.getAttribute('data-sgb-setting-input');
      if (!key) return;

      markSettingsAdjusting();
      saveBackgroundSettings({ [key]: Number(input.value) }, { skipRefresh: true });

      if (finalCommit) {
        setTimeout(() => {
          persistCurrentSettings('settings-range-commit');
          refreshNow('settings-commit').catch(err => {
            console.warn(`[${SCRIPT_NAME}] settings commit failed:`, err);
          });
        }, 0);
      }
    };

    const handleRangeInput = event => {
      commitRangeInput(event.target, false);
    };

    const handleRangeCommit = event => {
      commitRangeInput(event.target, true);
    };

    modal.addEventListener('input', handleRangeInput);
    modal.addEventListener('change', handleRangeCommit);
    modal.addEventListener('pointerup', handleRangeCommit, true);
    modal.addEventListener('touchend', handleRangeCommit, true);
    modal.addEventListener('blur', handleRangeCommit, true);

    const commitFontInput = (input, immediate = false) => {
      if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement) && !(input instanceof HTMLSelectElement)) return;
      const key = input.getAttribute('data-sgb-font-input');
      if (key !== 'customFontCssUrl' && key !== 'customFontFamily') return;

      const patch = {};
      let rawSource = getCurrentFontSourceInput(CONFIG);
      let normalizedSource = normalizeCustomFontCssUrl(CONFIG.customFontCssUrl);

      if (key === 'customFontCssUrl') {
        rawSource = writeFontDraftInput(input.value);
        normalizedSource = normalizeCustomFontCssUrl(rawSource);
        patch.customFontSourceInput = rawSource;

        if (!rawSource.trim()) {
          patch.customFontCssUrl = '';
          patch.customFontLocalId = '';
          patch.customFontFamily = '';
          patch.chatFont = 'none';
        } else if (normalizedSource) {
          const sourceChanged = normalizedSource !== normalizeCustomFontCssUrl(CONFIG.customFontCssUrl);
          patch.customFontCssUrl = normalizedSource;
          patch.customFontLocalId = '';
          if (sourceChanged) patch.customFontFamily = '';
          patch.chatFont = 'custom';
        }
      } else {
        patch.customFontFamily = input.value;
        patch.chatFont = (normalizeFontLibraryId(CONFIG.customFontLocalId) || normalizedSource || normalizeCustomFontFamily(input.value)) ? 'custom' : 'none';
      }

      const run = () => {
        const saved = saveBackgroundSettings(patch, { skipRefresh: true });
        if (normalizedSource && rawSource.trim()) {
          rememberWebFontInput(rawSource, getEffectiveCustomFontFamily(saved));
        }
        if (immediate) persistCurrentSettings('font-input-commit');
        setTimeout(() => {
          refreshNow('font-commit').catch(err => {
            console.warn(`[${SCRIPT_NAME}] font commit failed:`, err);
          });
        }, 0);
      };

      clearTimeout(state.fontApplyTimer);
      if (immediate) run();
      else state.fontApplyTimer = setTimeout(run, 220);
    };

    const handleFontInput = event => {
      const input = (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) ? event.target : null;
      commitFontInput(input, false);
    };

    const handleFontCommit = event => {
      const input = (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) ? event.target : null;
      commitFontInput(input, true);
    };

    modal.addEventListener('input', handleFontInput);
    modal.addEventListener('change', handleFontCommit);
    modal.addEventListener('blur', handleFontCommit, true);
    modal.addEventListener('paste', event => {
      const input = (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) ? event.target : null;
      if (input?.hasAttribute?.('data-sgb-font-input')) {
        setTimeout(() => commitFontInput(input, true), 80);
        setTimeout(() => commitFontInput(input, true), 220);
      }
    }, true);

    modal.addEventListener('change', event => {
      const librarySelect = event.target instanceof HTMLSelectElement && event.target.hasAttribute('data-sgb-font-library')
        ? event.target
        : null;
      if (!librarySelect) return;

      const [type, rawId] = String(librarySelect.value || '').split(':');
      const id = normalizeFontLibraryId(rawId);
      const entry = getFontLibraryEntry(id);
      if (!entry || entry.type !== type) return;

      if (type === 'web') {
        const rawSource = writeFontDraftInput(entry.source);
        const normalizedSource = normalizeCustomFontCssUrl(rawSource);
        const sourceInput = modal.querySelector('[data-sgb-font-input="customFontCssUrl"]');
        if (sourceInput instanceof HTMLTextAreaElement || sourceInput instanceof HTMLInputElement) sourceInput.value = rawSource;
        saveBackgroundSettings({
          customFontSourceInput: rawSource,
          customFontCssUrl: normalizedSource,
          customFontLocalId: '',
          customFontFamily: entry.family || '',
          chatFont: normalizedSource ? 'custom' : 'none'
        }, { skipRefresh: true });
        rememberWebFontInput(rawSource, entry.family || '');
      } else if (type === 'local') {
        saveBackgroundSettings({
          customFontLocalId: entry.id,
          customFontFamily: entry.family || '',
          chatFont: 'custom'
        }, { skipRefresh: true });
        loadLocalFontRuntime(entry.id).then(loaded => {
          if (!loaded || normalizeFontLibraryId(CONFIG.customFontLocalId) !== entry.id) return;
          injectCustomFontStyle();
          applyCssVars();
          syncSettingsUi();
        }).catch(err => console.warn(`[${SCRIPT_NAME}] local font selection failed:`, err));
      }

      persistCurrentSettings('font-library-select');
      refreshNow('font-library-select').catch(err => console.warn(`[${SCRIPT_NAME}] font library refresh failed:`, err));
    });

    modal.addEventListener('change', event => {
      const fileInput = event.target instanceof HTMLInputElement && event.target.hasAttribute('data-sgb-local-font-file')
        ? event.target
        : null;
      const file = fileInput?.files?.[0];
      if (!fileInput || !file) return;

      const output = modal.querySelector('[data-sgb-font-output]');
      if (output instanceof HTMLElement) output.textContent = '로컬 폰트 저장 중…';

      saveLocalFontFile(file).then(entry => {
        saveBackgroundSettings({
          customFontLocalId: entry.id,
          customFontFamily: entry.family || '',
          chatFont: 'custom'
        }, { skipRefresh: true });
        persistCurrentSettings('local-font-file');
        return loadLocalFontRuntime(entry.id);
      }).then(() => {
        injectCustomFontStyle();
        applyCssVars();
        syncSettingsUi();
        return refreshNow('local-font-file');
      }).catch(err => {
        console.warn(`[${SCRIPT_NAME}] local font import failed:`, err);
        if (output instanceof HTMLElement) output.textContent = err?.message || '로컬 폰트 저장 실패';
      }).finally(() => {
        fileInput.value = '';
      });
    });

    const syncColorControls = (key, value, activeInput = null) => {
      const picker = modal.querySelector(`[data-sgb-color-picker="${key}"]`);
      const code = modal.querySelector(`[data-sgb-color-code="${key}"]`);

      if (picker instanceof HTMLInputElement && picker !== activeInput) {
        picker.value = value;
      }
      if (code instanceof HTMLInputElement && code !== activeInput) {
        code.value = value;
      }
    };

    const applyColorDebounced = (key, value, delay = 140) => {
      clearTimeout(state.colorApplyTimer);
      state.colorApplyTimer = setTimeout(() => {
        saveBackgroundSettings({ [key]: value }, { skipRefresh: true });
      }, delay);
    };

    const handleColorPreview = event => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      if (!input) return;

      const key = input.getAttribute('data-sgb-color-picker') || input.getAttribute('data-sgb-color-code');
      if (!key) return;

      const current = normalizeBackgroundSettings(CONFIG);
      const raw = input.value.trim();
      const valid = /^#[0-9a-fA-F]{3}$/.test(raw) || /^#[0-9a-fA-F]{6}$/.test(raw);
      const nextColor = normalizeHexColor(raw, current[key]);

      if (!valid && input.getAttribute('data-sgb-color-code')) return;

      syncColorControls(key, nextColor, input);
      applyColorDebounced(key, nextColor, 140);
    };

    const handleColorCommit = event => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      if (!input) return;

      const key = input.getAttribute('data-sgb-color-picker') || input.getAttribute('data-sgb-color-code');
      if (!key) return;

      const current = normalizeBackgroundSettings(CONFIG);
      const nextColor = normalizeHexColor(input.value, current[key]);

      clearTimeout(state.colorApplyTimer);
      syncColorControls(key, nextColor, input);
      if (input.getAttribute('data-sgb-color-code')) {
        input.value = nextColor;
      }

      saveBackgroundSettings({ [key]: nextColor }, { skipRefresh: true });
    };

    modal.addEventListener('input', handleColorPreview);
    modal.addEventListener('change', handleColorCommit);
    modal.addEventListener('blur', handleColorCommit, true);

    modal.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      if (target === modal) {
        event.preventDefault();
        closeSettingsModal();
        return;
      }

      const tabButton = target.closest('[data-sgb-tab]');
      if (tabButton instanceof HTMLElement) {
        event.preventDefault();
        event.stopPropagation();
        const name = tabButton.getAttribute('data-sgb-tab') || 'style';
        modal.querySelectorAll('[data-sgb-tab]').forEach(button => {
          button.setAttribute('data-selected', button === tabButton ? 'true' : 'false');
        });
        modal.querySelectorAll('[data-pane]').forEach(pane => {
          pane.setAttribute('data-selected', pane.getAttribute('data-pane') === name ? 'true' : 'false');
        });
        return;
      }

      const paletteOption = target.closest('[data-sgb-style-palette]');
      if (paletteOption instanceof HTMLElement) {
        event.preventDefault();
        event.stopPropagation();

        const nextStyle = paletteOption.getAttribute('data-sgb-style-palette') || 'borderless';
        const paletteIndex = Math.max(0, Number(paletteOption.getAttribute('data-sgb-palette-index')) || 0);
        const palettePatch = getPalettePatchForStyle(nextStyle, paletteIndex);

        saveBackgroundSettings({
          ...(!CONFIG.themeRecommendedColorsEnabled ? { customColorBackup: createCustomColorBackup(CONFIG) } : {}),
          ...palettePatch,
          themeRecommendedColorsEnabled: true
        }, { skipRefresh: true });
        return;
      }

      const styleOption = target.closest('[data-sgb-ui-style-option]');
      if (styleOption instanceof HTMLElement) {
        event.preventDefault();
        event.stopPropagation();

        const nextStyle = styleOption.getAttribute('data-sgb-ui-style-option') || 'borderless';
        const palettePatch = getPalettePatchForStyle(nextStyle, 0);

        saveBackgroundSettings({
          ...(!CONFIG.themeRecommendedColorsEnabled ? { customColorBackup: createCustomColorBackup(CONFIG) } : {}),
          ...palettePatch,
          themeRecommendedColorsEnabled: true
        }, { skipRefresh: true });
        return;
      }

      if (target.closest('[data-sgb-modal-toggle]')) {
        event.preventDefault();
        event.stopPropagation();
        setBackgroundEnabled(!CONFIG.enabled);
        return;
      }

      const boolToggle = target.closest('[data-sgb-bool-toggle]');
      if (boolToggle instanceof HTMLElement) {
        const key = boolToggle.getAttribute('data-sgb-bool-toggle');
        if (key) {
          event.preventDefault();
          event.stopPropagation();

          if (key === 'themeRecommendedColorsEnabled') {
            saveBackgroundSettings(getThemeColorTogglePatch(!CONFIG.themeRecommendedColorsEnabled), { skipRefresh: true });
          } else {
            saveBackgroundSettings({ [key]: !CONFIG[key] }, { skipRefresh: true });
          }
        }
        return;
      }

      const shadowTone = target.closest('[data-sgb-shadow-tone]');
      if (shadowTone instanceof HTMLElement) {
        event.preventDefault();
        event.stopPropagation();
        saveBackgroundSettings({ textShadowTone: shadowTone.getAttribute('data-sgb-shadow-tone') || 'dark' }, { skipRefresh: true });
        return;
      }

      if (target.closest('[data-sgb-font-library-delete]')) {
        event.preventDefault();
        event.stopPropagation();
        const select = modal.querySelector('[data-sgb-font-library]');
        const selectedValue = select instanceof HTMLSelectElement ? select.value : '';
        if (!selectedValue) return;
        removeFontLibraryEntry(selectedValue).then(() => {
          syncSettingsUi();
          persistCurrentSettings('font-library-delete');
          refreshNow('font-library-delete').catch(err => console.warn(`[${SCRIPT_NAME}] font library delete refresh failed:`, err));
        }).catch(err => console.warn(`[${SCRIPT_NAME}] font library delete failed:`, err));
        return;
      }

      if (target.closest('[data-sgb-settings-reset]')) {
        event.preventDefault();
        event.stopPropagation();
        resetBackgroundSettings();
        return;
      }

      if (target.closest('[data-sgb-settings-close]')) {
        event.preventDefault();
        closeSettingsModal();
      }
    });

    modal.addEventListener('keydown', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;

      const styleOption = target.closest('[data-sgb-ui-style-option]');
      if (styleOption instanceof HTMLElement) {
        event.preventDefault();
        event.stopPropagation();

        const nextStyle = styleOption.getAttribute('data-sgb-ui-style-option') || 'borderless';
        const palettePatch = getPalettePatchForStyle(nextStyle, 0);

        saveBackgroundSettings({
          ...(!CONFIG.themeRecommendedColorsEnabled ? { customColorBackup: createCustomColorBackup(CONFIG) } : {}),
          ...palettePatch,
          themeRecommendedColorsEnabled: true
        }, { skipRefresh: true });
      }
    });

    return modal;
  }

  function openSettingsModal() {
    applySavedSettingsToConfig();

    let modal = document.getElementById(SGB_UI_IDS.modal);
    if (modal && modal.getAttribute('data-sgb-settings-layout') !== 'tabs-v14') {
      modal.remove();
      modal = null;
    }
    if (!modal) {
      modal = createSettingsModal();
      document.body.appendChild(modal);
    }

    modal.setAttribute('data-open', 'true');
    syncSettingsUi();

    requestAnimationFrame(() => {
      applySavedSettingsToConfig();
      syncSettingsUi();
    });

    const firstInput = modal.querySelector('[data-sgb-setting-input]');
    if (firstInput instanceof HTMLElement) {
      setTimeout(() => firstInput.focus({ preventScroll: true }), 0);
    }
  }

  function closeSettingsModal() {
    persistCurrentSettings('modal-close');
    const modal = document.getElementById(SGB_UI_IDS.modal);
    if (modal) modal.removeAttribute('data-open');

    requestAnimationFrame(() => {
      persistCurrentSettings('modal-close-raf');
    });
  }

  function syncSwitch(button, thumb, enabled) {
    if (button instanceof HTMLElement) {
      button.setAttribute('aria-checked', enabled ? 'true' : 'false');
      button.setAttribute('data-state', enabled ? 'checked' : 'unchecked');
      button.setAttribute('value', enabled ? 'on' : 'off');
    }
    if (thumb instanceof HTMLElement) {
      thumb.setAttribute('data-state', enabled ? 'checked' : 'unchecked');
    }
  }

  function syncSettingsUi() {
    const settings = normalizeBackgroundSettings(CONFIG);
    const enabled = !!settings.enabled;

    document.querySelectorAll('[data-sgb-settings-row]').forEach(row => {
      if (row instanceof HTMLElement) {
        row.setAttribute('data-sgb-enabled', enabled ? 'true' : 'false');
      }
    });

    document.querySelectorAll('[data-sgb-toggle-switch]').forEach(button => {
      const row = button.closest('[data-sgb-settings-row]');
      syncSwitch(button, row?.querySelector('[data-sgb-toggle-thumb]'), enabled);
    });

    const modal = document.getElementById(SGB_UI_IDS.modal);
    if (modal) {
      syncSwitch(modal.querySelector('[data-sgb-modal-toggle]'), modal.querySelector('[data-sgb-modal-toggle-thumb]'), enabled);

      [...getSettingsDefinitions(), { key: 'textScale' }, { key: 'codeTextScale' }, { key: 'fontWeight' }, { key: 'lineHeight' }, { key: 'letterSpacing' }, { key: 'paragraphSpacing' }].forEach(def => {
        const input = modal.querySelector(`[data-sgb-setting-input="${def.key}"]`);
        const output = modal.querySelector(`[data-sgb-setting-output="${def.key}"]`);

        if (input instanceof HTMLInputElement && document.activeElement !== input) {
          input.value = String(settings[def.key]);
        }
        if (output instanceof HTMLElement) {
          output.textContent = formatSettingValue(def.key, settings[def.key]);
        }
      });

      const fontCssInput = modal.querySelector('[data-sgb-font-input="customFontCssUrl"]');
      if ((fontCssInput instanceof HTMLInputElement || fontCssInput instanceof HTMLTextAreaElement) && document.activeElement !== fontCssInput) {
        fontCssInput.value = getCurrentFontSourceInput(settings);
      }
      const fontLibrarySelect = modal.querySelector('[data-sgb-font-library]');
      if (fontLibrarySelect instanceof HTMLSelectElement && document.activeElement !== fontLibrarySelect) {
        fontLibrarySelect.innerHTML = renderFontLibraryOptions(settings);
        fontLibrarySelect.value = getSelectedFontLibraryValue(settings);
      }
      const fontFamilySelect = modal.querySelector('[data-sgb-font-input="customFontFamily"]');
      if (fontFamilySelect instanceof HTMLSelectElement && document.activeElement !== fontFamilySelect) {
        fontFamilySelect.innerHTML = renderFontFamilyOptions(settings);
        fontFamilySelect.value = normalizeCustomFontFamily(settings.customFontFamily);
      }
      const fontOutput = modal.querySelector('[data-sgb-font-output]');
      if (fontOutput instanceof HTMLElement) {
        fontOutput.textContent = getChatFontLabel(settings);
      }

      ['themeRecommendedColorsEnabled', 'textShadowEnabled', 'dialogueBgEnabled', 'thoughtBgEnabled', 'italicBgEnabled', 'strongBgEnabled', 'codeBlockBgEnabled', 'markdownDecorEnabled'].forEach(key => {
        syncSwitch(
          modal.querySelector(`[data-sgb-bool-toggle="${key}"]`),
          modal.querySelector(`[data-sgb-bool-thumb="${key}"]`),
          !!settings[key]
        );
      });

      modal.querySelectorAll('[data-sgb-shadow-tone]').forEach(button => {
        if (!(button instanceof HTMLElement)) return;
        const selected = button.getAttribute('data-sgb-shadow-tone') === settings.textShadowTone;
        button.setAttribute('aria-checked', selected ? 'true' : 'false');
        button.setAttribute('data-selected', selected ? 'true' : 'false');
      });

      [...getColorSettingDefinitions(), ...getHighlightColorSettingDefinitions()].forEach(def => {
        const color = settings[def.key];
        const row = modal.querySelector(`[data-sgb-highlight-color-row="${def.key}"]`);
        if (row instanceof HTMLElement && def.when) {
          row.style.display = settings[def.when] ? '' : 'none';
        }

        const picker = modal.querySelector(`[data-sgb-color-picker="${def.key}"]`);
        const code = modal.querySelector(`[data-sgb-color-code="${def.key}"]`);

        if (picker instanceof HTMLInputElement && document.activeElement !== picker) picker.value = color;
        if (code instanceof HTMLInputElement && document.activeElement !== code) code.value = color;
      });

      modal.querySelectorAll('[data-sgb-ui-style-option]').forEach(button => {
        if (!(button instanceof HTMLElement)) return;
        const selected = button.getAttribute('data-sgb-ui-style-option') === settings.uiStyle;
        button.setAttribute('aria-checked', selected ? 'true' : 'false');
        button.setAttribute('data-selected', selected ? 'true' : 'false');
      });

      modal.querySelectorAll('[data-sgb-style-palette]').forEach(chip => {
        if (!(chip instanceof HTMLElement)) return;
        const style = chip.getAttribute('data-sgb-style-palette');
        const paletteIndex = Math.max(0, Number(chip.getAttribute('data-sgb-palette-index')) || 0);

        const selected =
          !!settings.themeRecommendedColorsEnabled &&
          style === settings.uiStyle &&
          paletteIndex === Math.max(0, Math.round(Number(settings.uiPaletteIndex) || 0));

        chip.setAttribute('data-selected', selected ? 'true' : 'false');
      });

    }
  }

  function isProbablyNovelBubble(bubble) {
    const cls = String(bubble?.className || '').toLowerCase();
    const style = String(bubble?.getAttribute?.('style') || '').toLowerCase().replace(/\s+/g, '');

    // 소설형/투명형 본문은 chat glass 배경을 칠하면 안 된다.
    // Crack 쪽 인라인 스타일이 background-color:transparent 처럼 공백 없이 들어오는 경우가 있어서
    // 기존 "background-color: transparent" 체크로는 못 잡던 문제를 수정.
    return cls.includes('rounded-none')
      || cls.includes('bg-transparent')
      || (cls.includes('px-0') && cls.includes('py-0'))
      || style.includes('background-color:transparent')
      || style.includes('background:transparent')
      || style.includes('border-radius:0')
      || style.includes('padding:12px0');
  }

  function decorateMessageBubbles() {
    document.querySelectorAll('main [data-message-group-id]').forEach(group => {
      group.setAttribute('data-sgb-message-group', '');
      group.removeAttribute('data-sgb-novel-group');
    });

    document.querySelectorAll('main [data-message-group-id] .wrtn-markdown').forEach(markdown => {
      if (!(markdown instanceof HTMLElement)) return;
      if (markdown.closest('.not-wrtn-markdown')) return;

      const bubble = markdown.closest('div[class*="break-all"]');
      if (!(bubble instanceof HTMLElement)) return;
      const group = bubble.closest('[data-message-group-id]');
      if (!(group instanceof HTMLElement)) return;
      if (bubble.closest('.csp-generated-scene-image')) return;

      const kind = isProbablyNovelBubble(bubble) ? 'novel' : 'chat';
      if (bubble.getAttribute('data-sgb-bubble') !== kind) {
        bubble.setAttribute('data-sgb-bubble', kind);
      }
      if (kind === 'novel') group.setAttribute('data-sgb-novel-group', '');

      const parent = bubble.parentElement;
      if (parent instanceof HTMLElement && !parent.hasAttribute('data-sgb-bubble-parent')) {
        parent.setAttribute('data-sgb-bubble-parent', '');
      }
    });

  }

  function decorateEditableEditors() {
    const editorSelector = ':is(.tiptap.ProseMirror[contenteditable="true"], .ProseMirror[contenteditable="true"], [contenteditable="true"][translate="no"], textarea)';

    // v1.8.9: 수정 완료 후 남은 edit 마커가 cozy/newsprint/starjar/jazzbar의 편집 배경을
    // 소설형 메시지에 다시 칠하던 문제를 막는다. 현재 편집 중인 bubble만 edit 마커를 유지한다.
    document.querySelectorAll('main [data-sgb-edit-bubble]').forEach(bubble => {
      if (!(bubble instanceof HTMLElement)) return;
      if (bubble.querySelector(editorSelector)) return;
      bubble.removeAttribute('data-sgb-edit-bubble');
      bubble.querySelectorAll('[data-sgb-edit-box]').forEach(box => {
        if (box instanceof HTMLElement) box.removeAttribute('data-sgb-edit-box');
      });
    });

    document.querySelectorAll(`main ${editorSelector}`).forEach(editor => {
      if (!(editor instanceof HTMLElement)) return;

      const bubble = editor.closest('div[class*="break-all"]');
      if (!(bubble instanceof HTMLElement)) return;
      if (!bubble.closest('main')) return;

      const group = bubble.closest('[data-message-group-id]');
      const kind = (isProbablyNovelBubble(bubble) || group?.hasAttribute?.('data-sgb-novel-group')) ? 'novel' : 'chat';

      bubble.setAttribute('data-sgb-edit-bubble', '');
      bubble.setAttribute('data-sgb-bubble', kind);
      if (kind === 'novel' && group instanceof HTMLElement) group.setAttribute('data-sgb-novel-group', '');

      const parent = bubble.parentElement;
      if (parent instanceof HTMLElement) parent.setAttribute('data-sgb-bubble-parent', '');

      const box = editor.closest('div[class*="rounded-lg"][class*="transition-colors"]')
        || editor.closest('div[class*="rounded-lg"]');
      if (box instanceof HTMLElement) box.setAttribute('data-sgb-edit-box', '');
    });
  }


  function decorateInput() {
    document.querySelectorAll('main .__chat_input_textarea').forEach(input => {
      if (!(input instanceof HTMLElement)) return;

      const box = input.closest('div[class*="rounded-lg"][class*="border"]');
      if (box instanceof HTMLElement) box.setAttribute('data-sgb-input-box', '');

      // 라디오존데 inline 모드는 입력창 바깥 host에 .igx-inline-overlay-host를 붙인다.
      // 예전에는 이 host를 제외해서 크랙 원본 bg-bg_screen 배경이 남아 검은 막처럼 보일 수 있었다.
      // #igx-live-popup 루트 위치/전환은 건드리지 않고, 입력창 host 배경 투명화 마커만 허용한다.
      const host = input.closest('div[class*="bg-bg_screen"]')
        || input.closest('div[class*="pointer-events-auto"]');

      if (host instanceof HTMLElement) host.setAttribute('data-sgb-input-host', '');
    });

    // 라디오존데:
    // #igx-live-popup 루트는 위치/전환 담당이라 position/display/visibility/transform/z-index/pointer-events를 건드리지 않는다.
    // 꾸미기는 내부 요소 위주로만 적용한다.
    const livePopup = document.querySelector('#igx-live-popup');
    if (livePopup instanceof HTMLElement) {
      livePopup.setAttribute('data-sgb-radiosonde-skin', '');
      livePopup.removeAttribute('data-sgb-top-glass-shell');

      const head = livePopup.querySelector('#igx-live-head');
      if (head instanceof HTMLElement) head.setAttribute('data-sgb-radiosonde-head', '');

      const barline = livePopup.querySelector('#igx-live-barline');
      if (barline instanceof HTMLElement) barline.setAttribute('data-sgb-radiosonde-barline', '');

      livePopup.querySelectorAll('.bitem, .igx-btn').forEach(el => {
        if (el instanceof HTMLElement) el.setAttribute('data-sgb-radiosonde-part', '');
      });
    }

    // 추천 답변 버튼만 별도 글라스 처리
    document.querySelectorAll('main button > .wrtn-markdown').forEach(markdown => {
      const button = markdown.closest('button');
      if (!(button instanceof HTMLElement)) return;
      if (button.closest('[data-message-group-id]')) return;
      if (button.closest('.csp-generated-scene-image')) return;
      if (button.closest('[role="dialog"], [data-radix-popper-content-wrapper]')) return;

      const style = String(button.getAttribute('style') || '');
      const looksLikeSuggestion =
        style.includes('surface_tertiary') ||
        /border-radius\s*:\s*20px/i.test(style) ||
        button.classList.contains('hover:bg-state_hover');

      if (looksLikeSuggestion) button.setAttribute('data-sgb-suggestion-button', '');
    });
  }

  function decorateHeader() {
    // 헤더/상단바는 원본 Crack UI 그대로 둔다.
    // 이전 테스트 버전에서 붙은 마커가 남아 있으면 제거만 한다.
    document.querySelectorAll('[data-sgb-header]').forEach(header => {
      if (header instanceof HTMLElement) header.removeAttribute('data-sgb-header');
    });
  }


  function splitByQuotes(text, openSet, closeSet, type) {
    const out = [];
    const n = text.length;
    let i = 0;

    while (i < n) {
      const ch = text[i];

      if (openSet.has(ch)) {
        let j = i + 1;
        while (j < n && !closeSet.has(text[j])) j++;
        if (j < n) {
          out.push({ type, text: text.slice(i, j + 1) });
          i = j + 1;
          continue;
        }

        out.push({ type: 'text', text: text.slice(i) });
        break;
      }

      let j = i;
      while (j < n && !openSet.has(text[j])) j++;
      out.push({ type: 'text', text: text.slice(i, j) });
      i = j;
    }

    return out;
  }

  function buildQuoteSegments(text) {
    // 큰따옴표를 최우선으로 처리한다.
    // 작은따옴표는 큰따옴표로 감싼 뒤, 남은 바깥 텍스트에서만 별도 처리한다.
    return splitByQuotes(text, DOUBLE_OPEN, DOUBLE_CLOSE, 'double');
  }

  function buildSingleQuoteSegments(text) {
    return splitByQuotes(text, SINGLE_OPEN, SINGLE_CLOSE, 'single');
  }

  function replaceTextNodeWithQuotes(textNode) {
    const value = textNode.nodeValue || '';
    const segs = buildQuoteSegments(value);
    if (!segs.some(s => s.type !== 'text')) return;

    const frag = document.createDocumentFragment();
    const insertedNodes = [];
    const groupId = `q${++state.quoteWrapSeq}`;

    segs.forEach(seg => {
      if (!seg.text) return;

      let node;
      if (seg.type === 'text') {
        node = document.createTextNode(seg.text);
      } else {
        node = document.createElement('span');
        node.setAttribute('data-sgb-quote', seg.type);
        node.setAttribute('data-sgb-quote-group', groupId);
        node.textContent = seg.text;
      }

      insertedNodes.push(node);
      frag.appendChild(node);
    });

    const parent = textNode.parentNode;
    if (!parent) return;

    state.quoteWraps.set(groupId, {
      originalNode: textNode,
      insertedNodes
    });

    parent.replaceChild(frag, textNode);
  }


  function replaceTextNodeWithSingleQuotes(textNode) {
    const value = textNode.nodeValue || '';
    const segs = buildSingleQuoteSegments(value);
    if (!segs.some(s => s.type !== 'text')) return;

    const frag = document.createDocumentFragment();
    const insertedNodes = [];
    const groupId = `q${++state.quoteWrapSeq}`;

    segs.forEach(seg => {
      if (!seg.text) return;

      let node;
      if (seg.type === 'text') {
        node = document.createTextNode(seg.text);
      } else {
        node = document.createElement('span');
        node.setAttribute('data-sgb-quote', seg.type);
        node.setAttribute('data-sgb-quote-group', groupId);
        node.textContent = seg.text;
      }

      insertedNodes.push(node);
      frag.appendChild(node);
    });

    const parent = textNode.parentNode;
    if (!parent) return;

    state.quoteWraps.set(groupId, {
      originalNode: textNode,
      insertedNodes
    });

    parent.replaceChild(frag, textNode);
  }

  function findCrossNodeQuoteRange(md) {
    const walker = document.createTreeWalker(md, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest('[data-sgb-quote]')) return NodeFilter.FILTER_REJECT;
        if (p.closest('code, pre, .not-wrtn-markdown')) return NodeFilter.FILTER_REJECT;
        if (!QUOTE_CHAR_RE.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let active = null;
    let node;
    while ((node = walker.nextNode())) {
      const value = node.nodeValue || '';
      for (let i = 0; i < value.length; i++) {
        const ch = value[i];

        if (!active) {
          if (DOUBLE_OPEN.has(ch)) {
            active = { type: 'double', startNode: node, startOffset: i, closeSet: DOUBLE_CLOSE };
          } else if (SINGLE_OPEN.has(ch)) {
            active = { type: 'single', startNode: node, startOffset: i, closeSet: SINGLE_CLOSE };
          }
          continue;
        }

        if (active.closeSet.has(ch)) {
          return {
            type: active.type,
            startNode: active.startNode,
            startOffset: active.startOffset,
            endNode: node,
            endOffset: i + 1
          };
        }
      }
    }

    return null;
  }

  function wrapCrossNodeQuoteRange(md) {
    const match = findCrossNodeQuoteRange(md);
    if (!match) return false;

    const range = document.createRange();
    range.setStart(match.startNode, match.startOffset);
    range.setEnd(match.endNode, match.endOffset);

    const groupId = `q${++state.quoteWrapSeq}`;
    const node = document.createElement('span');
    node.setAttribute('data-sgb-quote', match.type);
    node.setAttribute('data-sgb-quote-group', groupId);

    try {
      range.surroundContents(node);
    } catch (_) {
      const frag = range.extractContents();
      node.appendChild(frag);
      range.insertNode(node);
    }

    state.quoteWraps.set(groupId, { wrapperNode: node });
    range.detach?.();
    return true;
  }

  function collectQuoteTextNodes(md, quoteRe = QUOTE_CHAR_RE) {
    const walker = document.createTreeWalker(md, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest('[data-sgb-quote]')) return NodeFilter.FILTER_REJECT;
        if (p.closest('code, pre, .not-wrtn-markdown')) return NodeFilter.FILTER_REJECT;
        if (!quoteRe.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const targets = [];
    let node;
    while ((node = walker.nextNode())) targets.push(node);
    return targets;
  }

  function wrapQuotesInElement(md) {
    // 1순위: 큰따옴표 대사 강조.
    // 같은 텍스트 노드 안의 ""를 먼저 감싼 뒤, 마크다운 em/strong 때문에 노드가 갈라진 ""도 감싼다.
    collectQuoteTextNodes(md, /["「」❝❞]/).forEach(replaceTextNodeWithQuotes);

    let safety = 0;
    while (safety < 200 && wrapCrossNodeQuoteRange(md)) safety++;

    // 2순위: 작은따옴표 생각 강조.
    // 이미 data-sgb-quote로 감싼 큰따옴표 내부는 walker에서 제외되므로, "" 안에서는 ' ' 감지가 실행되지 않는다.
    collectQuoteTextNodes(md, /'/).forEach(replaceTextNodeWithSingleQuotes);
  }

  function resetQuoteDecorateCache(root = document) {
    try {
      root.querySelectorAll?.('main [data-message-group-id] .wrtn-markdown, .wrtn-markdown').forEach(md => {
        if (!(md instanceof HTMLElement)) return;
        delete md.dataset.sgbLen;
        delete md.dataset.sgbLenAt;
        delete md.dataset.sgbQuotedLen;
      });
    } catch (_) {}
  }

  function restoreTrackedQuoteWraps() {
    if (!(state.quoteWraps instanceof Map) || state.quoteWraps.size <= 0) return;

    for (const [groupId, record] of Array.from(state.quoteWraps.entries())) {
      try {
        const wrapperNode = record?.wrapperNode;
        if (wrapperNode instanceof HTMLElement) {
          if (wrapperNode.isConnected && wrapperNode.parentNode) {
            wrapperNode.replaceWith(...Array.from(wrapperNode.childNodes));
          }
          state.quoteWraps.delete(groupId);
          continue;
        }

        const originalNode = record?.originalNode;
        const insertedNodes = Array.isArray(record?.insertedNodes) ? record.insertedNodes : [];

        if (!(originalNode instanceof Text)) {
          state.quoteWraps.delete(groupId);
          continue;
        }

        const firstConnected = insertedNodes.find(node => node?.isConnected && node.parentNode);
        const parent = firstConnected?.parentNode || originalNode.parentNode;

        if (parent && !originalNode.isConnected) {
          parent.insertBefore(originalNode, firstConnected || null);
        }

        insertedNodes.forEach(node => {
          if (node && node !== originalNode && node.parentNode) {
            node.parentNode.removeChild(node);
          }
        });

        state.quoteWraps.delete(groupId);
      } catch (err) {
        console.warn(`[${SCRIPT_NAME}] quote restore failed:`, err);
      }
    }
  }

  function restoreLooseQuoteSpans() {
    // 이전 버전/핫리로드로 남은 span만 fallback 정리.
    // 자식 노드가 있으면 그대로 풀어 nested em/strong을 보존한다.
    document.querySelectorAll('span[data-sgb-quote]').forEach(span => {
      try {
        if (!(span instanceof HTMLElement)) return;
        const children = Array.from(span.childNodes);
        if (children.length > 0) span.replaceWith(...children);
        else span.replaceWith(document.createTextNode(span.textContent || ''));
      } catch (err) {
        console.warn(`[${SCRIPT_NAME}] loose quote unwrap failed:`, err);
      }
    });
  }

  function pruneQuoteWraps() {
    if (!(state.quoteWraps instanceof Map)) return;
    if (state.quoteWraps.size < 300) return;

    for (const [groupId, record] of state.quoteWraps) {
      const inserted = Array.isArray(record?.insertedNodes) ? record.insertedNodes : [];
      const anyConnected =
        inserted.some(node => node?.isConnected) ||
        !!record?.originalNode?.isConnected ||
        !!record?.wrapperNode?.isConnected;
      if (!anyConnected) state.quoteWraps.delete(groupId);
    }
  }

  function restoreQuoteHighlightsForReact() {
    try {
      restoreTrackedQuoteWraps();
      restoreLooseQuoteSpans();
      resetQuoteDecorateCache(document);
    } catch (err) {
      console.warn(`[${SCRIPT_NAME}] quote self-heal restore failed:`, err);
    }
  }

  function scheduleQuoteReapplyAfterReact(delay = 1400) {
    clearTimeout(state.quoteHealTimer);
    state.quoteHealTimer = window.setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            state.quoteHealUntil = 0;
            resetQuoteDecorateCache(document);
            decorateQuotes();
          } catch (err) {
            console.warn(`[${SCRIPT_NAME}] quote self-heal reapply failed:`, err);
          }
        });
      });
    }, Math.max(0, Number(delay) || 0));
  }

  function isNativeSituationImageToggle(target) {
    if (!(target instanceof Element)) return false;
    const row = target.closest('[role="button"]');
    if (!(row instanceof HTMLElement)) return false;
    if (row.closest(`#${SGB_UI_IDS.row}, [data-sgb-settings-row], #${SGB_UI_IDS.modal}`)) return false;
    return row.textContent?.trim?.().includes('상황 이미지 보기') || false;
  }

  function handleNativeSituationImageToggle(target) {
    if (!isNativeSituationImageToggle(target)) return false;

    state.quoteHealUntil = Date.now() + 1400;
    restoreQuoteHighlightsForReact();
    scheduleQuoteReapplyAfterReact(1500);
    return true;
  }

  function handleSameEpisodeSelfClick(event) {
    if (event.defaultPrevented) return false;
    if (event.button !== undefined && event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;

    const target = event.target;
    if (!(target instanceof Element)) return false;

    const link = target.closest('a[href]');
    if (!(link instanceof HTMLAnchorElement)) return false;

    let url;
    try {
      url = new URL(link.href, location.href);
    } catch (_) {
      return false;
    }

    if (url.origin !== location.origin) return false;
    if (url.pathname !== location.pathname) return false;

    const clickedRoomId = getRoomId(url.pathname);
    const currentRoomId = getRoomId(location.pathname);
    if (!clickedRoomId || clickedRoomId !== currentRoomId) return false;

    // Crack V27에서 채팅방 목록의 현재 방 링크를 다시 누르면 같은 episode를 재진입하며
    // 배경 레이어가 main 안에 있는 상태와 맞물려 오류 홈으로 빠지는 경우가 있다.
    // 이미 접속 중인 방 링크는 새 이동이 필요 없으므로 기본 동작만 막고 현재 화면을 유지한다.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    scheduleRefresh('same-episode-click-noop', 0);
    return true;
  }


  function decorateQuotes() {
    if (!isAnyQuoteHighlightEnabled()) return;
    if (Date.now() < Number(state.quoteHealUntil || 0)) return;

    const groups = Array.from(document.querySelectorAll('main [data-message-group-id]'));
    const recentFrom = Math.max(0, groups.length - 8);
    const now = Date.now();

    groups.forEach((group, index) => {
      const isRecent = index >= recentFrom;

      group.querySelectorAll('.wrtn-markdown').forEach(md => {
        if (!(md instanceof HTMLElement)) return;
        if (md.closest('.not-wrtn-markdown')) return;

        // 옛 메시지는 이미 처리 완료 표식이 있으면 전체 텍스트 길이 재계산을 생략한다.
        if (!isRecent && md.dataset.sgbQuotedLen !== undefined) return;

        const len = md.textContent.length;
        const prevLen = Number(md.dataset.sgbLen || -1);
        const quotedLen = Number(md.dataset.sgbQuotedLen || -2);

        if (len !== prevLen) {
          md.dataset.sgbLen = String(len);
          md.dataset.sgbLenAt = String(now);
          return;
        }
        if (quotedLen === len) return;
        if (now - Number(md.dataset.sgbLenAt || now) < 450) return;

        try {
          wrapQuotesInElement(md);
          md.dataset.sgbQuotedLen = String(len);
        } catch (err) {
          console.warn(`[${SCRIPT_NAME}] quote wrap failed:`, err);
        }
      });
    });
  }

  function decorateCodeblocks() {
    document.querySelectorAll('main .wrtn-codeblock').forEach(cb => {
      if (!(cb instanceof HTMLElement)) return;
      if (!cb.hasAttribute('data-sgb-codeblock')) cb.setAttribute('data-sgb-codeblock', '');

      const children = Array.from(cb.children).filter(el => el instanceof HTMLElement);
      const head = children[0];
      const body = children[1];

      if (head instanceof HTMLElement && !head.hasAttribute('data-sgb-codeblock-head')) head.setAttribute('data-sgb-codeblock-head', '');
      if (body instanceof HTMLElement && !body.hasAttribute('data-sgb-codeblock-body')) body.setAttribute('data-sgb-codeblock-body', '');
    });
  }

  function decorateLayout() {
    const now = Date.now();
    if (now - Number(state.__sgbDecorateAt || 0) < 120) return;
    state.__sgbDecorateAt = now;

    if (removeSettingsRowIfOutsideStrictEpisode()) {
      protectEriLoreInjectorUi();
      return;
    }

    decorateSettingsRow();
    protectEriLoreInjectorUi();
    if (!shouldApplyThemeSkin()) return;

    if (isNormalUiStyle()) {
      clearSgbUiDecorations();
      protectEriLoreInjectorUi();
      return;
    }

    decorateMessageBubbles();
    decorateEditableEditors();
    decorateInput();
    decorateHeader();
    decorateCodeblocks();
    decorateQuotes();
    protectEriLoreInjectorUi();
  }

  function schedulePatchLargePanels() {
    // 호환성 모드: 큰 패널/사이드바/#__next 투명화는 하지 않는다.
  }

  function patchLargeBackgroundPanels() {
    // 호환성 모드: no-op
  }

  function restoreLargeBackgroundPanels() {
    // 이전 테스트 버전이 남긴 inline 투명화 흔적만 복구한다.
    document.querySelectorAll('[data-sgb-transparent-panel="1"], [data-csp-sgb-transparent-panel="1"]').forEach(el => {
      if (!(el instanceof HTMLElement)) return;

      const bg = el.dataset.sgbBgOriginalBgColor || el.dataset.cspSgbOriginalBgColor;
      const image = el.dataset.sgbBgOriginalBgImage || el.dataset.cspSgbOriginalBgImage;

      if (bg && bg !== '__EMPTY__') el.style.backgroundColor = bg;
      else el.style.removeProperty('background-color');

      if (image && image !== '__EMPTY__') el.style.backgroundImage = image;
      else el.style.removeProperty('background-image');

      delete el.dataset.sgbBgTransparentPanel;
      delete el.dataset.sgbBgOriginalBgColor;
      delete el.dataset.sgbBgOriginalBgImage;
      delete el.dataset.cspSgbTransparentPanel;
      delete el.dataset.cspSgbOriginalBgColor;
      delete el.dataset.cspSgbOriginalBgImage;
    });
  }

  function injectStyle() {
    document.getElementById(IDS.style)?.remove();

    const style = document.createElement('style');
    style.id = IDS.style;
    style.textContent = `
      html.${CLS_ROOM} {
        /* 부팅 직후 폴백. 실시간 값은 applyCssVars()의 인라인 setProperty가 담당. */
        --sgb-chat-light-alpha: ${CONFIG.chatBubbleOpacityLight};
        --sgb-chat-dark-alpha: ${CONFIG.chatBubbleOpacityDark};
        --sgb-border: rgba(255,255,255,.28);
        --sgb-readable-text: ${CONFIG.textColor || '#fafafa'};
        --sgb-muted-text: ${CONFIG.emColor || '#85837d'};
        --sgb-strong-text: ${CONFIG.strongColor || '#fafafa'};
        --sgb-italic-text: ${CONFIG.italicTextColor || CONFIG.emColor || '#84827e'};
        --sgb-strong-highlight-text: ${CONFIG.strongBgTextColor || CONFIG.strongColor || '#fafafa'};
        --sgb-live-bg: rgba(69, 58, 104, .42);
        --sgb-live-border: rgba(207, 189, 255, .28);
      }


      /* 채팅 본문 폰트 선택.
         v1.3.33부터 내장 웹폰트 대신 직접 입력한 폰트 이름/CSS URL만 사용한다.
         코드블록(pre/code)은 별도 크기 슬라이더가 있으므로 본문 폰트를 강제하지 않는다. */
      html.${CLS_ACTIVE}[data-sgb-chat-font="custom"] main .wrtn-markdown,
      html.${CLS_ACTIVE}[data-sgb-chat-font="custom"] main .wrtn-markdown :is(p, li, blockquote, h1, h2, h3, h4, h5, h6, span, em, a) {
        font-family: var(--sgb-custom-chat-font-stack), 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif !important;
        font-weight: var(--sgb-font-weight, 400) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-chat-font="custom"] main .wrtn-markdown strong {
        font-family: var(--sgb-custom-chat-font-stack), 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif !important;
        font-weight: max(700, var(--sgb-font-weight, 400)) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-chat-font="custom"] main .wrtn-markdown :is(pre, code, kbd, samp),
      html.${CLS_ACTIVE}[data-sgb-chat-font="custom"] main [data-sgb-codeblock],
      html.${CLS_ACTIVE}[data-sgb-chat-font="custom"] main [data-sgb-codeblock] * {
        font-family: var(--sgb-custom-chat-font-stack, inherit) !important;
      }

      html.${CLS_ACTIVE} {
        background: #050507 !important;
        overflow-x: hidden !important;
        overscroll-behavior-x: none !important;
      }

      html.${CLS_ACTIVE} body {
        overflow-x: hidden !important;
        overscroll-behavior-x: none !important;
      }

      /* V27의 이미지 보관함/플레이 가이드/대화 프로필/시작 설정 패널은
         #__next 또는 main 안쪽 공용 컨테이너에 붙는다.
         예전처럼 #__next를 max-height:100vh + overflow:hidden으로 잠그면
         패널이 잘리거나 클릭이 먹통처럼 보일 수 있다.
         배경 레이어는 position:fixed라 자체 고정되므로 세로 잠금은 제거하고
         가로 밀림만 막는다. */
      html.${CLS_ACTIVE} body > #__next {
        min-height: 100vh !important;
      }

      #${IDS.root} {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 0;
        pointer-events: none !important;
        user-select: none !important;
        overflow: hidden !important;
        margin: 0 !important;
        padding: 0 !important;
        min-width: 0 !important;
        min-height: 0 !important;
        max-width: none !important;
        max-height: none !important;
        flex: 0 0 auto !important;
        display: block !important;
        background: #050507;
        opacity: 0;
        transition: opacity 180ms ease;
      }

      html.${CLS_IMAGE_ACTIVE} #${IDS.root} {
        opacity: 1;
      }

      html[data-sgb-adjusting="true"] #${IDS.bg} {
        transition: none !important;
        will-change: auto !important;
      }

      #${IDS.bg} {
        position: absolute;
        inset: calc(-1 * var(--sgb-blur, 6px) - 18px);
        width: calc(100% + (var(--sgb-blur, 6px) * 2) + 36px);
        height: calc(100% + (var(--sgb-blur, 6px) * 2) + 36px);
        max-width: none !important;
        object-fit: var(--sgb-object-fit, contain);
        object-position: var(--sgb-object-position, center center);
        opacity: var(--sgb-image-opacity, .52);
        filter:
          blur(var(--sgb-blur, 8px))
          saturate(var(--sgb-saturate, 1.05))
          brightness(var(--sgb-effective-brightness, .82));
        transform: scale(var(--sgb-scale, 1.06));
        transform-origin: center center;
        transition:
          opacity 180ms ease,
          filter 180ms ease,
          transform 180ms ease;
        will-change: transform, filter, opacity;
      }

      #${IDS.dim} {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at 50% 34%, rgba(255,255,255,.035), transparent 44%),
          rgba(0, 0, 0, var(--sgb-dim-overlay, .06));
      }

      html.${CLS_ACTIVE} main[data-sgb-main-host] {
        position: relative !important;
        isolation: isolate;
        background: transparent !important;
      }

      /* 배경 레이어보다 채팅 본문만 위로 올린다.
         V27 설정 패널/팝오버/사이드바는 main 안에 붙을 수 있으므로
         role/radix/sidebar 계열은 position/z-index 강제 대상에서 제외한다. */
      html.${CLS_ACTIVE} main[data-sgb-main-host] > :not(#${IDS.root}):not([role="dialog"]):not([role="menu"]):not([role="listbox"]):not([id^="radix-"]):not([data-radix-popper-content-wrapper]):not(:has(.ring-offset-sidebar)) {
        position: relative;
        z-index: 1;
      }

      /* main 안의 큰 래퍼 배경만 살짝 걷되, V27 설정 패널/팝오버/사이드바는 건드리지 않는다.
         이미지 보관함/플레이 가이드/대화 프로필/시작 설정은 main 안쪽 패널로 열릴 수 있고,
         이 패널까지 투명화하면 안 열린 것처럼 보이거나 클릭이 먹통처럼 느껴진다. */
      html.${CLS_ACTIVE} main[data-sgb-main-host] > div:not(#${IDS.root}):not([role="dialog"]):not([role="menu"]):not([role="listbox"]):not([id^="radix-"]):not([data-radix-popper-content-wrapper]):not(:has(.ring-offset-sidebar)) {
        background-color: transparent !important;
        background-image: none !important;
      }

      html.${CLS_ACTIVE} main[data-sgb-main-host] > div:not(#${IDS.root}):not([role="dialog"]):not([role="menu"]):not([role="listbox"]):not([id^="radix-"]):not([data-radix-popper-content-wrapper]):not(:has(.ring-offset-sidebar)) > div:not([role="dialog"]):not([role="menu"]):not([role="listbox"]):not([id^="radix-"]):not([data-radix-popper-content-wrapper]):not(:has(.ring-offset-sidebar)) {
        background-color: transparent !important;
        background-image: none !important;
      }

      html.${CLS_ACTIVE} [data-sgb-bubble-parent] {
        background-color: transparent !important;
        background-image: none !important;
      }

      html.${CLS_ACTIVE} [data-sgb-bubble="chat"] {
        background-color: rgba(18,21,30,var(--sgb-chat-dark-alpha, .30)) !important;
        background-image: none !important;
        border: 1px solid rgba(205,216,255,.18) !important;
        box-shadow: 0 18px 54px rgba(0,0,0,.18);
        backdrop-filter: blur(var(--sgb-glass-blur, 10px)) saturate(1.16);
        -webkit-backdrop-filter: blur(var(--sgb-glass-blur, 10px)) saturate(1.16);
      }

      html.${CLS_ACTIVE}[data-sgb-theme="light"] [data-sgb-bubble="chat"] {
        background-color: rgba(255,255,255,var(--sgb-chat-light-alpha, .34)) !important;
        border-color: rgba(255,255,255,.32) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-theme="dark"] [data-sgb-bubble="chat"] {
        background-color: rgba(18,21,30,var(--sgb-chat-dark-alpha, .30)) !important;
        border-color: rgba(205,216,255,.18) !important;
      }
      /* Glass: 모양은 그대로, 테두리 악센트만 팔레트색을 따라감 */
      html.${CLS_ACTIVE}[data-sgb-ui-style="glass"][data-sgb-theme="dark"] [data-sgb-bubble="chat"] {
        border-color: rgba(var(--sgb-dialogue-rgb,150,180,235),.18) !important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="glass"][data-sgb-theme="dark"] [data-sgb-input-box],
      html.${CLS_ACTIVE}[data-sgb-ui-style="glass"][data-sgb-theme="dark"] [data-sgb-suggestion-button] {
        border-color: rgba(var(--sgb-dialogue-rgb,150,180,235),.22) !important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="glass"][data-sgb-theme="dark"] [data-sgb-top-glass-shell]::before {
        border-color: rgba(var(--sgb-dialogue-rgb,150,180,235),.20) !important;
      }

      html.${CLS_ACTIVE} [data-sgb-bubble="novel"] {
        background-color: transparent !important;
        background-image: none !important;
        border-color: transparent !important;
        box-shadow: none !important;
      }

      html.${CLS_ACTIVE} [data-sgb-input-host] {
        background-color: transparent !important;
        background-image: none !important;
        padding-bottom: var(--sgb-input-bottom, 16px) !important;
      }


      /* 턴수 & 크래커 표시기 호환:
         해당 확프가 #my-custom-info-display에 인라인 background-color를 넣어도
         배경 확프 사용 중에는 입력창 위 검정 막이 남지 않게 한다.
         설정 메뉴(#info-display-settings-menu)는 건드리지 않음. */
      html.${CLS_ACTIVE} #my-custom-info-display {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        box-shadow: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }

      html.${CLS_ACTIVE} [data-sgb-input-box] {
        overflow: visible !important;
        color: var(--sgb-readable-text) !important;
        background-color: rgba(28,30,34,.66) !important;
        background-image: linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.025)) !important;
        border-color: rgba(255,255,255,.18) !important;
        box-shadow: 0 12px 42px rgba(0,0,0,.18) !important;
        backdrop-filter: blur(var(--sgb-glass-blur, 12px)) saturate(1.06);
        -webkit-backdrop-filter: blur(var(--sgb-glass-blur, 12px)) saturate(1.06);
      }

      html.${CLS_ACTIVE}[data-sgb-theme="light"] [data-sgb-input-box] {
        background-color: rgba(255,255,255,.84) !important;
        background-image: linear-gradient(180deg, rgba(255,255,255,.46), rgba(255,255,255,.18)) !important;
        color: rgba(32, 38, 52, .92) !important;
        border-color: rgba(255,255,255,.68) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-theme="dark"] [data-sgb-input-box] {
        background-color: rgba(28,30,34,.66) !important;
        background-image: linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.025)) !important;
        border-color: rgba(255,255,255,.18) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-theme="light"] [data-sgb-input-box] .__chat_input_textarea,
      html.${CLS_ACTIVE}[data-sgb-theme="light"] [data-sgb-input-box] .__chat_input_textarea * {
        color: rgba(32, 38, 52, .92) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-theme="dark"] [data-sgb-input-box] .__chat_input_textarea,
      html.${CLS_ACTIVE}[data-sgb-theme="dark"] [data-sgb-input-box] .__chat_input_textarea * {
        color: var(--sgb-readable-text) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-theme="light"] [data-sgb-input-box] .is-editor-empty:first-child:before {
        color: rgba(70, 78, 96, .62) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-theme="dark"] [data-sgb-input-box] .is-editor-empty:first-child:before {
        color: rgba(232,238,255,.54) !important;
      }

      html.${CLS_ACTIVE} [data-sgb-input-box]::before,
      html.${CLS_ACTIVE} [data-sgb-input-box]::after {
        content: none !important;
        display: none !important;
      }

      html.${CLS_ACTIVE}:not([data-sgb-ui-style="normal"]) main .wrtn-markdown {
        color: var(--sgb-readable-text) !important;
        position: relative;
        isolation: isolate;
        filter: none !important;
      }

      html.${CLS_ACTIVE}:not([data-sgb-ui-style="normal"]) main .wrtn-markdown :is(p, li, blockquote, h1, h2, h3, h4, h5, h6) {
        color: var(--sgb-readable-text) !important;
        text-shadow: none !important;
      }

      html.${CLS_ACTIVE}:not([data-sgb-ui-style="normal"])[data-sgb-text-shadow="on"] main [data-sgb-message-group] .wrtn-markdown {
        filter:
          drop-shadow(0 1px 1px rgba(var(--sgb-text-shadow-rgb, 0, 0, 0), var(--sgb-text-shadow-a1, .78)))
          drop-shadow(0 0 2px rgba(var(--sgb-text-shadow-rgb, 0, 0, 0), var(--sgb-text-shadow-a2, .56)))
          drop-shadow(0 2px 6px rgba(var(--sgb-text-shadow-rgb, 0, 0, 0), var(--sgb-text-shadow-a3, .34))) !important;
      }

      html.${CLS_ACTIVE} main .wrtn-markdown :is(p, li, blockquote) {
        font-size: calc(1em * var(--sgb-text-scale, 1)) !important;
        line-height: var(--sgb-line-height, 1.65) !important;
        letter-spacing: var(--sgb-letter-spacing, 0em) !important;
      }

      html.${CLS_ACTIVE} main .wrtn-markdown :is(p, blockquote) {
        margin-top: 0 !important;
        margin-bottom: var(--sgb-paragraph-spacing, .70rem) !important;
      }

      html.${CLS_ACTIVE} main .wrtn-markdown :is(p, blockquote):last-child {
        margin-bottom: 0 !important;
      }

      /* 문단 간격 슬라이더와 무관하게, 코드블럭 아래 일반 글이 딱 붙는 현상만 보정 */
      html.${CLS_ACTIVE} main [data-sgb-message-group] .wrtn-markdown :is(pre, .wrtn-codeblock, [data-sgb-codeblock]) + :is(p, blockquote) {
        margin-top: .80em !important;
      }

      html.${CLS_ACTIVE} main .wrtn-markdown li {
        margin-top: calc(var(--sgb-paragraph-spacing, .70rem) * .25) !important;
        margin-bottom: calc(var(--sgb-paragraph-spacing, .70rem) * .25) !important;
      }

      html.${CLS_ACTIVE} main .wrtn-markdown :is(p, li, blockquote) :is(em, strong, span, a, code) {
        font-size: inherit !important;
      }

      html.${CLS_ACTIVE}:not([data-sgb-ui-style="normal"]) main .wrtn-markdown em {
        color: var(--sgb-muted-text) !important;
        text-shadow: none !important;
      }

      html.${CLS_ACTIVE}:not([data-sgb-ui-style="normal"]) main .wrtn-markdown strong {
        color: var(--sgb-strong-text) !important;
        text-shadow: none !important;
      }

      html.${CLS_ACTIVE}:not([data-sgb-ui-style="normal"]) main .not-wrtn-markdown,
      html.${CLS_ACTIVE}:not([data-sgb-ui-style="normal"]) main .not-wrtn-markdown * {
        text-shadow: none !important;
        filter: none !important;
      }


      /* ===== 대사 / 생각 / 이탤릭 / 굵게 / 코드블록 강조 ===== */
      html.${CLS_ACTIVE} main [data-sgb-message-group] [data-sgb-quote],
      html.${CLS_ACTIVE} main [data-sgb-message-group] .wrtn-markdown em,
      html.${CLS_ACTIVE} main [data-sgb-message-group] .wrtn-markdown strong {
        -webkit-box-decoration-break: clone;
        box-decoration-break: clone;
        transition: background-color .16s ease, border-color .16s ease, box-shadow .16s ease;
      }

      html.${CLS_ACTIVE}[data-sgb-dialogue-bg="on"] main [data-sgb-message-group] [data-sgb-quote="double"] {
        color: var(--sgb-dialogue-text, #fdfbfc) !important;
      }
      html.${CLS_ACTIVE}[data-sgb-thought-bg="on"] main [data-sgb-message-group] [data-sgb-quote="single"] {
        color: var(--sgb-thought-text, #f4eef1) !important;
      }
      html.${CLS_ACTIVE}[data-sgb-italic-bg="off"] main [data-sgb-message-group] .wrtn-markdown em {
        font-style: normal !important;
      }
      html.${CLS_ACTIVE}[data-sgb-italic-bg="on"] main [data-sgb-message-group] .wrtn-markdown em {
        color: var(--sgb-italic-text, var(--sgb-muted-text)) !important;
        font-style: italic !important;
      }
      html.${CLS_ACTIVE}[data-sgb-strong-bg="on"] main [data-sgb-message-group] .wrtn-markdown strong {
        color: var(--sgb-strong-highlight-text, var(--sgb-strong-text)) !important;
      }

      /* 형광펜 */
      html.${CLS_ACTIVE}[data-sgb-highlight-shape="highlight"][data-sgb-dialogue-bg="on"] main [data-sgb-message-group] [data-sgb-quote="double"],
      html.${CLS_ACTIVE}[data-sgb-highlight-shape="highlight"][data-sgb-thought-bg="on"] main [data-sgb-message-group] [data-sgb-quote="single"],
      html.${CLS_ACTIVE}[data-sgb-highlight-shape="highlight"][data-sgb-italic-bg="on"] main [data-sgb-message-group] .wrtn-markdown em,
      html.${CLS_ACTIVE}[data-sgb-highlight-shape="highlight"][data-sgb-strong-bg="on"] main [data-sgb-message-group] .wrtn-markdown strong {
        border: none !important;
        border-radius: 4px;
        padding: .02em .16em;
        box-shadow: none !important;
      }

      /* 기능별 색 */
      html.${CLS_ACTIVE}[data-sgb-dialogue-bg="on"][data-sgb-highlight-shape="highlight"] main [data-sgb-message-group] [data-sgb-quote="double"] {
        background: linear-gradient(180deg, transparent 36%, rgba(var(--sgb-dialogue-rgb, 178,154,166), .34) 36%);
      }
      html.${CLS_ACTIVE}[data-sgb-thought-bg="on"][data-sgb-highlight-shape="highlight"] main [data-sgb-message-group] [data-sgb-quote="single"] {
        background: linear-gradient(180deg, transparent 36%, rgba(var(--sgb-thought-rgb, 168,154,166), .28) 36%);
      }
      html.${CLS_ACTIVE}[data-sgb-italic-bg="on"][data-sgb-highlight-shape="highlight"] main [data-sgb-message-group] .wrtn-markdown em {
        background: linear-gradient(180deg, transparent 38%, rgba(var(--sgb-italic-rgb, 232,224,228), .18) 38%);
      }
      html.${CLS_ACTIVE}[data-sgb-strong-bg="on"][data-sgb-highlight-shape="highlight"] main [data-sgb-message-group] .wrtn-markdown strong {
        background: linear-gradient(180deg, transparent 38%, rgba(var(--sgb-strongbg-rgb, 240,224,232), .22) 38%);
      }

      html.${CLS_ACTIVE}[data-sgb-code-bg="on"] main [data-sgb-codeblock] {
        border-radius: 14px !important;
        overflow: hidden;
        border: 1px solid rgba(var(--sgb-code-rgb, 200,166,182), .30) !important;
        box-shadow: 0 12px 32px rgba(0,0,0,.20), inset 0 1px 0 rgba(255,255,255,.04) !important;
        background: rgba(var(--sgb-code-rgb, 200,166,182), .10) !important;
        backdrop-filter: blur(calc(var(--sgb-glass-blur, 12px) * .55)) saturate(1.04) !important;
        -webkit-backdrop-filter: blur(calc(var(--sgb-glass-blur, 12px) * .55)) saturate(1.04) !important;
      }
      html.${CLS_ACTIVE}[data-sgb-code-bg="on"] main [data-sgb-codeblock-head] {
        background: rgba(var(--sgb-code-rgb, 200,166,182), .16) !important;
        border-bottom: 1px solid rgba(var(--sgb-code-rgb, 200,166,182), .20) !important;
      }
      html.${CLS_ACTIVE}[data-sgb-code-bg="on"] main [data-sgb-codeblock-body] {
        background: rgba(12,14,18,.52) !important;
      }
      html.${CLS_ACTIVE}[data-sgb-code-bg="on"] main [data-sgb-codeblock] code,
      html.${CLS_ACTIVE}[data-sgb-code-bg="on"] main [data-sgb-codeblock] pre {
        text-shadow: none !important;
      }

      /* 코드블록 글씨 크기: 코드블록 배경 ON/OFF와 무관하게 적용.
         색/자간/행간은 유지하고, 글꼴만 본문 폰트를 따라가게 한다. */
      html.${CLS_ACTIVE} main [data-sgb-codeblock] {
        --sgb-codeblock-font-size: calc(13px * var(--sgb-code-text-scale, 1));
      }

      html.${CLS_ACTIVE} main [data-sgb-codeblock-body],
      html.${CLS_ACTIVE} main [data-sgb-codeblock-body] :is(pre, code, span, div) {
        font-family: var(--sgb-custom-chat-font-stack), 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif !important;
        font-size: var(--sgb-codeblock-font-size) !important;
        line-height: 1.45 !important;
        letter-spacing: 0 !important;
        font-weight: 400 !important;
      }


      html.${CLS_ACTIVE} [data-sgb-message-group] > div[class*="mb-5"] {
        margin-bottom: .55rem !important;
      }

      /* ===== 마크다운 렌더러 꾸미기 =====
         기존 대사/생각/이탤릭/굵게/코드블록 강조는 건드리지 않는다.
         여기서는 제목/인용문/목록/구분선/링크/표/인라인 코드만 정리한다.
         - 제목 h1~h6: 박스/테두리/밑줄/심볼 없음, 강조 글자색만
         - 인용문 blockquote: 박스 없음, 왼쪽 작대기만
         - ul: 테마별 bullet 심볼
         - ol: 숫자 유지, 색만 테마톤
      */
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]){
        --sgb-md-accent:rgba(var(--sgb-dialogue-rgb,178,154,166),.52);
        --sgb-md-accent-soft:rgba(var(--sgb-dialogue-rgb,178,154,166),.12);
        --sgb-md-line:rgba(255,255,255,.14);
        --sgb-md-quote-line:rgba(var(--sgb-dialogue-rgb,178,154,166),.26);
        --sgb-md-code-bg:rgba(255,255,255,.08);
        --sgb-md-code-text:var(--sgb-strong-text,#fff);
        --sgb-md-list-marker:"•  ";
        --sgb-md-heading-prefix:"› ";
        --sgb-md-heading-symbol-color:var(--sgb-md-accent);
        --sgb-md-radius:9px;
      }

      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="borderless"],
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="glass"]{
        --sgb-md-accent:rgba(205,216,255,.50);
        --sgb-md-accent-soft:rgba(205,216,255,.10);
        --sgb-md-line:rgba(205,216,255,.15);
        --sgb-md-quote-line:rgba(205,216,255,.22);
        --sgb-md-code-bg:rgba(18,21,32,.28);
        --sgb-md-list-marker:"•  ";
        --sgb-md-heading-prefix:"› ";
        --sgb-md-heading-symbol-color:rgba(205,216,255,.50);
      }
      /* Glass: 마크다운 꾸밈색을 팔레트(대사색)에 맞춰 물들임 */
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="glass"]{
        --sgb-md-accent:rgba(var(--sgb-dialogue-rgb,150,180,235),.52);
        --sgb-md-accent-soft:rgba(var(--sgb-dialogue-rgb,150,180,235),.12);
        --sgb-md-line:rgba(var(--sgb-dialogue-rgb,150,180,235),.16);
        --sgb-md-quote-line:rgba(var(--sgb-dialogue-rgb,150,180,235),.26);
        --sgb-md-code-bg:rgba(18,21,32,.30);
        --sgb-md-heading-symbol-color:rgba(var(--sgb-dialogue-rgb,150,180,235),.52);
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="pixel"]{
        --sgb-md-accent:rgba(var(--sgb-dialogue-rgb,157,216,255),.58);
        --sgb-md-accent-soft:rgba(var(--sgb-dialogue-rgb,157,216,255),.12);
        --sgb-md-line:rgba(var(--sgb-dialogue-rgb,157,216,255),.22);
        --sgb-md-quote-line:rgba(var(--sgb-dialogue-rgb,157,216,255),.30);
        --sgb-md-code-bg:rgba(10,13,18,.50);
        --sgb-md-code-text:var(--sgb-strong-text,#b9e8ff);
        --sgb-md-list-marker:"◆  ";
        --sgb-md-heading-prefix:"◆ ";
        --sgb-md-heading-symbol-color:var(--sgb-md-accent);
        --sgb-md-radius:4px;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="sticker"]{
        --sgb-md-accent:rgba(255,214,232,.58);
        --sgb-md-accent-soft:rgba(255,214,232,.12);
        --sgb-md-line:rgba(255,255,255,.22);
        --sgb-md-quote-line:rgba(255,214,232,.30);
        --sgb-md-code-bg:rgba(255,255,255,.11);
        --sgb-md-list-marker:"✿  ";
        --sgb-md-heading-prefix:"✿ ";
        --sgb-md-heading-symbol-color:rgba(255,214,232,.58);
        --sgb-md-radius:12px;
      }
      /* Sticker: 마크다운 꾸밈색을 팔레트(대사색)에 맞춰 물들임 */
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="sticker"]{
        --sgb-md-accent:rgba(var(--sgb-dialogue-rgb,255,190,214),.58);
        --sgb-md-accent-soft:rgba(var(--sgb-dialogue-rgb,255,190,214),.12);
        --sgb-md-line:rgba(var(--sgb-dialogue-rgb,255,190,214),.30);
        --sgb-md-quote-line:rgba(var(--sgb-dialogue-rgb,255,190,214),.32);
        --sgb-md-code-bg:rgba(var(--sgb-dialogue-rgb,255,190,214),.12);
        --sgb-md-heading-symbol-color:rgba(var(--sgb-dialogue-rgb,255,190,214),.58);
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="candy"]{
        --sgb-md-accent:rgba(var(--sgb-dialogue-rgb,255,183,205),.64);
        --sgb-md-accent-soft:rgba(var(--sgb-dialogue-rgb,255,183,205),.12);
        --sgb-md-line:rgba(var(--sgb-italic-rgb,255,233,173),.20);
        --sgb-md-quote-line:rgba(var(--sgb-dialogue-rgb,255,183,205),.32);
        --sgb-md-code-bg:rgba(255,255,255,.12);
        --sgb-md-list-marker:"♡  ";
        --sgb-md-heading-prefix:"♡ ";
        --sgb-md-heading-symbol-color:var(--sgb-md-accent);
        --sgb-md-radius:10px;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="najeon"]{
        --sgb-md-accent:rgba(154,223,214,.52);
        --sgb-md-accent-soft:rgba(178,142,214,.12);
        --sgb-md-line:rgba(190,232,226,.18);
        --sgb-md-quote-line:rgba(154,223,214,.28);
        --sgb-md-code-bg:rgba(20,26,38,.34);
        --sgb-md-code-text:#bff4ec;
        --sgb-md-list-marker:"◇  ";
        --sgb-md-heading-prefix:"◇ ";
        --sgb-md-heading-symbol-color:rgba(154,223,214,.52);
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="starjar"]{
        --sgb-md-accent:rgba(238,207,142,.56);
        --sgb-md-accent-soft:rgba(238,207,142,.12);
        --sgb-md-line:rgba(238,207,142,.18);
        --sgb-md-quote-line:rgba(238,207,142,.30);
        --sgb-md-code-bg:rgba(255,220,140,.10);
        --sgb-md-code-text:#ffe8aa;
        --sgb-md-list-marker:"✦  ";
        --sgb-md-heading-prefix:"✦ ";
        --sgb-md-heading-symbol-color:rgba(238,207,142,.56);
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="cozy"]{
        --sgb-md-accent:rgba(98,63,30,.68);
        --sgb-md-accent-soft:rgba(98,63,30,.16);
        --sgb-md-line:rgba(98,63,30,.48);
        --sgb-md-quote-line:rgba(98,63,30,.42);
        --sgb-md-code-bg:rgba(207,168,110,.18);
        --sgb-md-code-text:#412B0F;
        --sgb-md-list-marker:"–  ";
        --sgb-md-heading-prefix:"";
        --sgb-md-heading-symbol-color:rgba(138,98,52,.56);
        --sgb-md-radius:8px;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="codepad"]{
        --sgb-md-accent:rgba(var(--sgb-dialogue-rgb,224,184,108),.60);
        --sgb-md-accent-soft:rgba(var(--sgb-dialogue-rgb,224,184,108),.18);
        --sgb-md-line:rgba(var(--sgb-dialogue-rgb,224,184,108),.38);
        --sgb-md-quote-line:rgba(var(--sgb-dialogue-rgb,224,184,108),.32);
        --sgb-md-code-bg:rgba(12,15,20,.48);
        --sgb-md-code-text:var(--sgb-strong-text,#f0cb82);
        --sgb-md-list-marker:"❯  ";
        --sgb-md-heading-prefix:"❯ ";
        --sgb-md-heading-symbol-color:rgba(var(--sgb-dialogue-rgb,224,184,108),.50);
        --sgb-md-radius:7px;
      }
      /* Jazzbar: 마크다운 마커 = 음표 ♪ */
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="jazzbar"]{
        --sgb-md-list-marker:"♪  ";
        --sgb-md-heading-prefix:"♪ ";
      }
      /* Newsprint: 제목 § · 불릿 ▪ */
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="newsprint"]{
        --sgb-md-accent:rgba(92,67,38,.72);
        --sgb-md-accent-soft:rgba(92,67,38,.18);
        --sgb-md-line:rgba(92,67,38,.50);
        --sgb-md-quote-line:rgba(92,67,38,.42);
        --sgb-md-list-marker:"▪  ";
        --sgb-md-heading-prefix:"§ ";
        --sgb-md-heading-symbol-color:rgba(92,67,38,.72);
      }

      /* Borderless: 마크다운 마커 없음 */
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="borderless"]{
        --sgb-md-list-marker:"";
        --sgb-md-heading-prefix:"";
      }

      /* Newsprint: 밝은 종이 위 인라인코드 가독성 강제 보정 */
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="newsprint"]{
        --sgb-md-code-text:#2b2118;
        --sgb-md-code-bg:rgba(92,72,45,.20);
      }

      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="newsprint"] main [data-sgb-message-group] .wrtn-markdown :not(pre) > code,
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="newsprint"] main [data-sgb-message-group] .wrtn-markdown p code,
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="newsprint"] main [data-sgb-message-group] .wrtn-markdown li code,
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="newsprint"] main [data-sgb-message-group] .wrtn-markdown td code,
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="newsprint"] main [data-sgb-message-group] .wrtn-markdown th code{
        color:#2b2118!important;
        -webkit-text-fill-color:#2b2118!important;
        background:rgba(92,72,45,.20)!important;
        border:1px solid rgba(92,72,45,.34)!important;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.22)!important;
        text-shadow:none!important;
      }

      /* Newsprint: 밝은 종이 위 링크 텍스트 가독성 보정 */
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="newsprint"] main [data-sgb-message-group] .wrtn-markdown a{
        color:#5a3418!important;
        text-decoration-color:rgba(90,52,24,.48)!important;
        text-underline-offset:.16em!important;
      }

      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="newsprint"] main [data-sgb-message-group] .wrtn-markdown a:hover{
        color:#2b2118!important;
        text-decoration-color:rgba(43,33,24,.68)!important;
      }



      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown :is(h1,h2,h3,h4,h5,h6){
        display:block!important;
        margin:.88em 0 .48em!important;
        padding:0!important;
        color:var(--sgb-strong-text)!important;
        background:none!important;
        background-image:none!important;
        border:0!important;
        border-radius:0!important;
        box-shadow:none!important;
        transform:none!important;
        text-shadow:none!important;
        font-weight:850!important;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown h1{font-size:1.30em!important}
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown h2{font-size:1.18em!important}
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown h3{font-size:1.10em!important}
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown h4{font-size:1.00em!important}
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown h5{font-size:.92em!important}
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown h6{font-size:.625em!important}
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown :is(h1,h2,h3,h4,h5,h6)::before{
        content:var(--sgb-md-heading-prefix,"")!important;
        display:inline!important;
        color:var(--sgb-md-heading-symbol-color,var(--sgb-md-accent))!important;
        text-shadow:none!important;
      }

      /* Cozy 전용: 곰 얼굴 제목 + 발바닥 불릿 (텍스트 심볼 대신 SVG) */
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="cozy"] main [data-sgb-message-group] .wrtn-markdown :is(h1,h2,h3,h4,h5,h6){
        display:flex!important;align-items:center!important;gap:7px!important;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="cozy"] main [data-sgb-message-group] .wrtn-markdown :is(h1,h2,h3,h4,h5,h6)::before{
        content:""!important;display:inline-block!important;flex:none!important;
        width:22px!important;height:22px!important;
        background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><circle cx='11' cy='12' r='6' fill='%238a6234'/><circle cx='29' cy='12' r='6' fill='%238a6234'/><circle cx='20' cy='23' r='12.5' fill='%23a3743f'/><ellipse cx='20' cy='27' rx='6' ry='4.5' fill='%23ecd7b6'/><circle cx='15.5' cy='21' r='1.7' fill='%233a2716'/><circle cx='24.5' cy='21' r='1.7' fill='%233a2716'/><ellipse cx='20' cy='25' rx='1.9' ry='1.3' fill='%233a2716'/></svg>")!important;
        background-size:contain!important;background-repeat:no-repeat!important;background-position:center!important;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="cozy"] main [data-sgb-message-group] .wrtn-markdown ul>li{
        position:relative!important;
        list-style:none!important;
        padding-left:21px!important;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="cozy"] main [data-sgb-message-group] .wrtn-markdown ul>li::marker{
        content:""!important;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="cozy"] main [data-sgb-message-group] .wrtn-markdown ul>li::before{
        content:""!important;
        position:absolute!important;
        left:0!important;
        top:.28em!important;
        display:block!important;
        width:14px!important;height:14px!important;
        margin:0!important;
        background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><ellipse cx='12' cy='16' rx='6' ry='5' fill='%238a6234'/><circle cx='5' cy='9' r='2.4' fill='%238a6234'/><circle cx='12' cy='6.5' r='2.6' fill='%238a6234'/><circle cx='19' cy='9' r='2.4' fill='%238a6234'/></svg>")!important;
        background-size:contain!important;background-repeat:no-repeat!important;background-position:center!important;
      }

      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="cozy"] main [data-sgb-message-group] .wrtn-markdown ul>li:has(input[type="checkbox"]){
        padding-left:21px!important;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="cozy"] main [data-sgb-message-group] .wrtn-markdown ul>li input[type="checkbox"]{
        margin-left:0!important;
      }

      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown blockquote{
        margin:.72em 0!important;
        padding:.08em 0 .08em .78em!important;
        color:var(--sgb-readable-text)!important;
        background:transparent!important;
        background-image:none!important;
        border:0!important;
        border-left:3px solid var(--sgb-md-quote-line)!important;
        border-radius:0!important;
        box-shadow:none!important;
        text-shadow:none!important;
        font-family:inherit!important;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown blockquote::before{
        content:none!important;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown blockquote blockquote{
        margin:.45em 0 .18em!important;
        padding-left:.68em!important;
        border-left-width:2px!important;
        opacity:.92!important;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="sticker"] main [data-sgb-message-group] .wrtn-markdown blockquote{
        border-left-style:dashed!important;
      }
      /* Sticker: 구분선 점선(- - - -) + 팔레트색 */
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="sticker"] main [data-sgb-message-group] .wrtn-markdown hr{
        height:0!important;
        background:none!important;
        border:0!important;
        border-top:2px dashed rgba(var(--sgb-dialogue-rgb,255,190,214),.55)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="najeon"] main [data-sgb-message-group] .wrtn-markdown blockquote{
        border-left-style:double!important;
      }

      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown :is(ul,ol){
        margin:.62em 0 .72em!important;
        padding-left:1.45em!important;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown ul > li::marker{
        content:var(--sgb-md-list-marker,"•  ")!important;
        color:var(--sgb-md-accent)!important;
        font-size:.95em!important;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown ol > li::marker{
        color:var(--sgb-md-accent)!important;
        font-weight:700!important;
      }

      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown hr{
        height:1px!important;
        margin:1.05em 0!important;
        border:0!important;
        background:linear-gradient(90deg, transparent, var(--sgb-md-line), var(--sgb-md-accent-soft), var(--sgb-md-line), transparent)!important;
      }

      /* v1.9.3: Cozy/Stone에서 표 아래 markdown hr이 배경에 묻히는 케이스 보정 */
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="cozy"] main [data-sgb-message-group] .wrtn-markdown hr{
        height:2px!important;
        min-height:2px!important;
        background:linear-gradient(90deg, transparent 0%, rgba(94,54,24,.72) 28%, rgba(136,89,43,.88) 50%, rgba(94,54,24,.72) 72%, transparent 100%)!important;
        opacity:1!important;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="codepad"] main [data-sgb-message-group] .wrtn-markdown hr{
        height:2px!important;
        min-height:2px!important;
        background:linear-gradient(90deg, transparent 0%, rgba(232,199,151,.66) 28%, rgba(244,218,174,.80) 50%, rgba(232,199,151,.66) 72%, transparent 100%)!important;
        opacity:1!important;
      }

      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown a{
        color:var(--sgb-md-code-text)!important;
        text-decoration:none!important;
        border-bottom:1px solid var(--sgb-md-accent)!important;
        text-shadow:none!important;
      }

      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown :is(p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th) code{
        padding:.08em .34em!important;
        border-radius:6px!important;
        color:var(--sgb-md-code-text)!important;
        background:var(--sgb-md-code-bg)!important;
        border:1px solid var(--sgb-md-line)!important;
        text-shadow:none!important;
        font-size:.92em!important;
      }

      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown table{
        width:auto!important;
        max-width:100%!important;
        min-width:0!important;
        table-layout:auto!important;
        display:table!important;
        margin:.85em 0!important;
        border-collapse:collapse!important;
        border-spacing:0!important;
        overflow:visible!important;
        border:1px solid var(--sgb-md-line)!important;
        border-radius:0!important;
        background:transparent!important;
        box-shadow:none!important;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown :is(th,td){
        padding:.46em .58em!important;
        border-right:1px solid var(--sgb-md-line)!important;
        border-bottom:1px solid var(--sgb-md-line)!important;
        color:var(--sgb-readable-text)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown :is(th,td):last-child{border-right:1px solid var(--sgb-md-line)!important}
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown tr:last-child :is(th,td){border-bottom:1px solid var(--sgb-md-line)!important}
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown th{
        color:var(--sgb-strong-text)!important;
        background:var(--sgb-md-accent-soft)!important;
        font-weight:800!important;
      }

      /* Markdown table v1.4.0: 순정 표에 가깝게, 내용 너비 기준 + 테두리 잘림 방지 */
      /* Markdown table v1.4.1: 마지막 행/열 셀 테두리를 유지해 밝은 종이 테마에서도 외곽선이 사라지지 않게 한다. */
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown table,
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"]:not([data-sgb-ui-style="normal"]) main [data-sgb-message-group] .wrtn-markdown table *{
        clip-path:none!important;
      }

      /* Markdown table v1.4.2: 종이 계열 테마별 표 선명도 분리 */
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="cozy"] main [data-sgb-message-group] .wrtn-markdown table{
        border-color:rgba(145,111,66,.24)!important;
      }

      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="cozy"] main [data-sgb-message-group] .wrtn-markdown :is(th,td),
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="cozy"] main [data-sgb-message-group] .wrtn-markdown :is(th,td):last-child,
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="cozy"] main [data-sgb-message-group] .wrtn-markdown tr:last-child :is(th,td){
        border-color:rgba(145,111,66,.20)!important;
      }

      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="newsprint"] main [data-sgb-message-group] .wrtn-markdown table{
        border-color:rgba(43,33,24,.78)!important;
      }

      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="newsprint"] main [data-sgb-message-group] .wrtn-markdown :is(th,td),
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="newsprint"] main [data-sgb-message-group] .wrtn-markdown :is(th,td):last-child,
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="newsprint"] main [data-sgb-message-group] .wrtn-markdown tr:last-child :is(th,td){
        border-color:rgba(43,33,24,.62)!important;
      }

      /* ===== ✦ STARJAR — 별 담은 유리병 (남보라+금별) ===== */
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"][data-sgb-theme-colors="on"]{
        --sgb-readable-text:#f0eede!important;
        --sgb-muted-text:#c8bd9c!important;
        --sgb-strong-text:#fff6e2!important;
        --sgb-italic-text:#d7cda9!important;
        --sgb-strong-highlight-text:#fff6e2!important;
        --sgb-dialogue-rgb:240,207,126!important;
        --sgb-dialogue-text:#ffe8aa!important;
        --sgb-thought-rgb:150,142,196!important;
        --sgb-thought-text:#ece4d0!important;
        --sgb-italic-rgb:200,189,156!important;
        --sgb-strongbg-rgb:255,220,140!important;
        --sgb-code-rgb:214,180,120!important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"] [data-sgb-bubble="chat"]{
        position:relative!important;
        border-radius:16px!important;
        color:var(--sgb-readable-text)!important;
        overflow:visible!important;
        background:
          radial-gradient(90% 70% at 12% 0%, rgba(112,104,148,calc(var(--sgb-theme-surface-alpha,.86)*.16)), transparent 58%),
          radial-gradient(80% 70% at 92% 96%, rgba(96,78,118,calc(var(--sgb-theme-surface-alpha,.86)*.12)), transparent 62%),
          linear-gradient(180deg, rgba(41,42,72,calc(var(--sgb-theme-surface-alpha,.86)*.76)), rgba(28,30,58,calc(var(--sgb-theme-surface-alpha,.86)*.74)))!important;
        border:1px solid rgba(238,207,142,.30)!important;
        box-shadow:0 0 14px rgba(238,198,120,.055),0 10px 26px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,235,190,.085)!important;
        backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.34)) saturate(1.06)!important;
        -webkit-backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.34)) saturate(1.06)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"][data-sgb-theme-colors="on"] [data-sgb-bubble="chat"] .wrtn-markdown{
        filter:none!important;
      }

      /* 말풍선 테두리 금별: 위 3개 / 아래 4개로 살짝 더 반짝이게 */
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"] [data-sgb-bubble="chat"]::before{
        content:"✦ ⋆ ✧"!important;
        position:absolute!important;
        top:-11px!important;
        left:15px!important;
        font-size:11px!important;
        letter-spacing:3px!important;
        color:#ffe0a0!important;
        text-shadow:0 0 6px rgba(255,210,120,.42)!important;
        pointer-events:none!important;
        z-index:2!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"] [data-sgb-bubble="chat"]::after{
        content:"⋆ ✧ ⋆ ✦"!important;
        position:absolute!important;
        bottom:-10px!important;
        right:13px!important;
        font-size:10px!important;
        letter-spacing:3px!important;
        color:#ffe0a0!important;
        text-shadow:0 0 6px rgba(255,210,120,.36)!important;
        pointer-events:none!important;
        z-index:2!important;
      }

      /* Starjar 강조는 공통 highlight 규칙을 타고, 색 변수만 테마톤으로 맞춘다. */
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"][data-sgb-dialogue-bg="on"] main [data-sgb-message-group] [data-sgb-quote="double"]{
        color:var(--sgb-dialogue-text,#ffe8aa)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"][data-sgb-thought-bg="on"] main [data-sgb-message-group] [data-sgb-quote="single"]{
        color:var(--sgb-thought-text,#ece4d0)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"][data-sgb-italic-bg="on"] main [data-sgb-message-group] .wrtn-markdown em{
        color:var(--sgb-italic-text,#d7cda9)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"][data-sgb-strong-bg="on"] main [data-sgb-message-group] .wrtn-markdown strong{
        color:var(--sgb-strong-highlight-text,#fff6e2)!important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"] [data-sgb-suggestion-button]{
        border-radius:14px!important;
        color:var(--sgb-readable-text)!important;
        background:
          radial-gradient(90% 80% at 8% 0%, rgba(112,104,148,calc(var(--sgb-theme-surface-alpha,.86)*.11)), transparent 60%),
          linear-gradient(180deg, rgba(39,40,70,var(--sgb-theme-surface-alpha,.86)), rgba(29,31,58,var(--sgb-theme-surface-alpha,.86)))!important;
        border:1px solid rgba(238,207,142,.27)!important;
        box-shadow:0 0 10px rgba(238,198,120,.05),0 8px 18px rgba(0,0,0,.28)!important;
        backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.3)) saturate(1.05)!important;
        -webkit-backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.3)) saturate(1.05)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"] [data-sgb-suggestion-button] .wrtn-markdown em{
        color:var(--sgb-muted-text)!important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"] [data-sgb-input-box]{
        position:relative!important;
        border-radius:14px!important;
        color:var(--sgb-readable-text)!important;
        overflow:visible!important;
        background:
          radial-gradient(90% 80% at 10% 0%, rgba(112,104,148,calc(var(--sgb-theme-surface-alpha,.86)*.10)), transparent 60%),
          linear-gradient(180deg, rgba(34,36,64,var(--sgb-theme-surface-alpha,.86)), rgba(26,29,55,var(--sgb-theme-surface-alpha,.86)))!important;
        border:1px solid rgba(238,207,142,.24)!important;
        box-shadow:0 0 10px rgba(238,198,120,.045),0 10px 20px rgba(0,0,0,.24)!important;
        backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.3)) saturate(1.05)!important;
        -webkit-backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.3)) saturate(1.05)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"] [data-sgb-input-box]::after{
        content:"⋆ ✦"!important;
        position:absolute!important;
        top:-7px!important;
        right:22px!important;
        font-size:10px!important;
        letter-spacing:5px!important;
        color:#ffe0a0!important;
        text-shadow:0 0 6px rgba(255,210,120,.38)!important;
        pointer-events:none!important;
        z-index:2!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"] [data-sgb-input-box] .is-editor-empty:first-child:before{
        color:rgba(200,189,156,.6)!important;
      }

      /* 수정창 가독성 */
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"][data-sgb-theme-colors="on"] main [data-sgb-edit-bubble]{
        --sgb-readable-text:#f0eede!important;
        --sgb-muted-text:#c8bd9c!important;
        --sgb-strong-text:#fff6e2!important;
        --sgb-italic-text:#d7cda9!important;
        --sgb-strong-highlight-text:#fff6e2!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"] main [data-sgb-edit-bubble]{
        color:var(--sgb-readable-text)!important;
        background:
          radial-gradient(90% 70% at 12% 0%, rgba(112,104,148,.13), transparent 58%),
          linear-gradient(180deg, rgba(41,42,72,.72), rgba(28,30,58,.70))!important;
        border:1px solid rgba(238,207,142,.28)!important;
        text-shadow:none!important;
      }

      /* 코드블록 바디 톤 */
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"][data-sgb-code-bg="on"] main [data-sgb-codeblock-body]{
        background:rgba(16,20,46,.6)!important;
      }

      /* Starjar 라존데: 펼친 상태만 유리병 톤으로 장식, inline 도킹은 레이아웃 보존 */
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline){
        position:relative!important;
        overflow:visible!important;
        border-radius:15px!important;
        color:var(--sgb-readable-text)!important;
        background:
          radial-gradient(90% 70% at 14% 0%, rgba(112,104,148,calc(var(--sgb-theme-surface-alpha,.86)*.14)), transparent 58%),
          linear-gradient(180deg, rgba(40,42,72,calc(var(--sgb-theme-surface-alpha,.86)*.88)), rgba(27,30,58,calc(var(--sgb-theme-surface-alpha,.86)*.86)))!important;
        border:1px solid rgba(238,207,142,.30)!important;
        box-shadow:0 0 12px rgba(238,198,120,.055),0 10px 24px rgba(0,0,0,.30),inset 0 1px 0 rgba(255,235,190,.085)!important;
        backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.22)) saturate(1.05)!important;
        -webkit-backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.22)) saturate(1.05)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline)::before{
        content:"✦ ⋆ ✧"!important;
        position:absolute!important;
        top:-8px!important;
        right:18px!important;
        font-size:10px!important;
        letter-spacing:5px!important;
        color:#ffe0a0!important;
        text-shadow:0 0 6px rgba(255,210,120,.40)!important;
        pointer-events:none!important;
        z-index:2!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline),
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline) *{
        color:var(--sgb-readable-text)!important;
        filter:none!important;
        text-shadow:none!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"] #igx-live-popup[data-sgb-radiosonde-skin] #igx-live-head,
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"] #igx-live-popup[data-sgb-radiosonde-skin] .igx-btn{
        background:rgba(238,207,142,.085)!important;
        color:var(--sgb-readable-text)!important;
        border-color:rgba(238,207,142,.22)!important;
        box-shadow:inset 0 1px 0 rgba(255,235,190,.08)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline) #igx-live-head{
        border-radius:11px!important;
        border:1px solid rgba(238,207,142,.18)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"] #igx-live-popup[data-sgb-radiosonde-skin] .igx-btn{
        border-radius:999px!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"] #igx-live-popup[data-sgb-radiosonde-skin] .igx-btn:hover{
        background:rgba(238,207,142,.14)!important;
        border-color:rgba(238,207,142,.36)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline) .bitem{
        background:rgba(255,255,255,.035)!important;
        border-color:rgba(255,220,140,.11)!important;
        color:var(--sgb-readable-text)!important;
      }


      html.${CLS_ACTIVE} [data-sgb-top-glass-shell] {
        position: relative !important;
        isolation: isolate;
        border-radius: 999px !important;
      }

      html.${CLS_ACTIVE} [data-sgb-top-glass-shell]::before {
        content: "";
        position: absolute;
        inset: -6px -2px -5px -2px;
        z-index: -1;
        pointer-events: none;
        border-radius: 999px;
        background:
          linear-gradient(180deg, rgba(255,255,255,.26), rgba(255,255,255,.08)),
          rgba(255,255,255,.16);
        border: 1px solid rgba(255,255,255,.24);
        box-shadow: 0 10px 26px rgba(0,0,0,.14), inset 0 1px 0 rgba(255,255,255,.18);
        backdrop-filter: blur(calc(var(--sgb-glass-blur, 12px) + 2px)) saturate(1.12);
        -webkit-backdrop-filter: blur(calc(var(--sgb-glass-blur, 12px) + 2px)) saturate(1.12);
      }

      html.${CLS_ACTIVE}[data-sgb-theme="dark"] [data-sgb-top-glass-shell]::before {
        background:
          linear-gradient(180deg, rgba(255,255,255,.12), rgba(255,255,255,.035)),
          rgba(18,21,32,.34);
        border-color: rgba(205,216,255,.20);
      }

      html.${CLS_ACTIVE} [data-sgb-suggestion-button] {
        background-color: rgba(255,255,255,var(--sgb-ui-medium-alpha,.46)) !important;
        background-image: linear-gradient(180deg, rgba(255,255,255,.24), rgba(255,255,255,.08)) !important;
        border: 1px solid rgba(255,255,255,.42) !important;
        color: rgba(33, 38, 52, .94) !important;
        box-shadow: 0 10px 26px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.16) !important;
        backdrop-filter: blur(var(--sgb-glass-blur, 12px)) saturate(1.14) !important;
        -webkit-backdrop-filter: blur(var(--sgb-glass-blur, 12px)) saturate(1.14) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-theme="dark"] [data-sgb-suggestion-button] {
        background-color: rgba(18,21,32,var(--sgb-ui-medium-alpha,.42)) !important;
        background-image: linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,.03)) !important;
        border-color: rgba(205,216,255,.24) !important;
        color: var(--sgb-readable-text) !important;
      }

      html.${CLS_ACTIVE} [data-sgb-suggestion-button] .wrtn-markdown,
      html.${CLS_ACTIVE} [data-sgb-suggestion-button] .wrtn-markdown :is(p, em, strong) {
        color: inherit !important;
        text-shadow: none !important;
      }

      html.${CLS_ACTIVE}[data-sgb-theme="light"] [data-sgb-suggestion-button] .wrtn-markdown em {
        color: rgba(74, 82, 100, .82) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-theme="dark"] [data-sgb-suggestion-button] .wrtn-markdown em {
        color: rgba(220,226,238,.78) !important;
      }

      /* ===== 전체 UI 테마 추천 색 팔레트 ===== */
      html.${CLS_ACTIVE}[data-sgb-ui-style="borderless"][data-sgb-theme-colors="on"]{
        --sgb-readable-text:#fafafa!important;--sgb-muted-text:#a6a5a7!important;--sgb-strong-text:#ffffff!important;--sgb-italic-text:#c4c1ca!important;--sgb-strong-highlight-text:#fff8ff!important;
        --sgb-dialogue-rgb:185,165,180!important;--sgb-dialogue-text:#fdfbfc!important;--sgb-thought-rgb:172,162,182!important;--sgb-thought-text:#f5eff3!important;
        --sgb-italic-rgb:225,218,226!important;--sgb-strongbg-rgb:238,224,234!important;--sgb-code-rgb:200,170,188!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="glass"][data-sgb-theme-colors="on"]{
        --sgb-readable-text:#f2f6ff!important;--sgb-muted-text:#a4a6ab!important;--sgb-strong-text:#ffffff!important;--sgb-italic-text:#c7ceda!important;--sgb-strong-highlight-text:#f7fcff!important;
        --sgb-dialogue-rgb:150,180,235!important;--sgb-dialogue-text:#eef4ff!important;--sgb-thought-rgb:150,165,205!important;--sgb-thought-text:#f2f5ff!important;
        --sgb-italic-rgb:175,190,225!important;--sgb-strongbg-rgb:200,215,255!important;--sgb-code-rgb:150,178,228!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="pixel"][data-sgb-theme-colors="on"]{
        --sgb-readable-text:#ecf6ff!important;--sgb-muted-text:#9fa2a9!important;--sgb-strong-text:#ffffff!important;--sgb-italic-text:#c4cbd6!important;--sgb-strong-highlight-text:#f7fff0!important;
        --sgb-dialogue-rgb:120,215,225!important;--sgb-dialogue-text:#eafcff!important;--sgb-thought-rgb:125,155,215!important;--sgb-thought-text:#eef5ff!important;
        --sgb-italic-rgb:120,170,205!important;--sgb-strongbg-rgb:130,220,230!important;--sgb-code-rgb:110,185,212!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="sticker"][data-sgb-theme-colors="on"]{
        --sgb-readable-text:#f7f6ff!important;--sgb-muted-text:#b0afb5!important;--sgb-strong-text:#ffffff!important;--sgb-italic-text:#d0c8cf!important;--sgb-strong-highlight-text:#fff7fb!important;
        --sgb-dialogue-rgb:255,190,214!important;--sgb-dialogue-text:#fff2f7!important;--sgb-thought-rgb:188,222,255!important;--sgb-thought-text:#eef6ff!important;
        --sgb-italic-rgb:255,224,165!important;--sgb-strongbg-rgb:255,196,220!important;--sgb-code-rgb:190,224,255!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="candy"][data-sgb-theme-colors="on"]{
        --sgb-readable-text:#fcfcff!important;--sgb-muted-text:#b6b5bb!important;--sgb-strong-text:#ffffff!important;--sgb-italic-text:#d2cfd8!important;--sgb-strong-highlight-text:#fff8fc!important;
        --sgb-dialogue-rgb:255,185,202!important;--sgb-dialogue-text:#fff1f6!important;--sgb-thought-rgb:178,222,255!important;--sgb-thought-text:#eef6ff!important;
        --sgb-italic-rgb:255,228,168!important;--sgb-strongbg-rgb:255,190,206!important;--sgb-code-rgb:182,224,255!important}

      /* ===== UI Style Variants: Glass는 기존 기본값 그대로 ===== */

      html.${CLS_ACTIVE}[data-sgb-ui-style="pixel"] [data-sgb-bubble="chat"],
      html.${CLS_ACTIVE}[data-sgb-ui-style="pixel"] [data-sgb-input-box],
      html.${CLS_ACTIVE}[data-sgb-ui-style="pixel"] [data-sgb-suggestion-button] {
        border-radius: 4px !important;
        border: 1.5px solid rgba(var(--sgb-dialogue-rgb,120,215,225),.30) !important;
        box-shadow: 3px 3px 0 rgba(0,0,0,.20), inset 0 0 0 1px rgba(255,255,255,.055) !important;
        backdrop-filter: blur(calc(var(--sgb-glass-blur, 12px) * .58)) saturate(1.02) !important;
        -webkit-backdrop-filter: blur(calc(var(--sgb-glass-blur, 12px) * .58)) saturate(1.02) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="pixel"] [data-sgb-bubble="chat"] {
        background-color: rgba(13, 16, 24, var(--sgb-ui-soft-alpha,.38)) !important;
        background-image:
          linear-gradient(90deg, rgba(var(--sgb-dialogue-rgb,120,215,225),.028) 1px, transparent 1px),
          linear-gradient(180deg, rgba(var(--sgb-dialogue-rgb,120,215,225),.028) 1px, transparent 1px) !important;
        background-size: 8px 8px !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="pixel"] [data-sgb-input-box],
      html.${CLS_ACTIVE}[data-sgb-ui-style="pixel"] [data-sgb-suggestion-button] {
        background-color: rgba(13, 16, 24, var(--sgb-ui-medium-alpha,.46)) !important;
        background-image:
          linear-gradient(90deg, rgba(var(--sgb-dialogue-rgb,120,215,225),.026) 1px, transparent 1px),
          linear-gradient(180deg, rgba(var(--sgb-dialogue-rgb,120,215,225),.026) 1px, transparent 1px),
          linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.018)) !important;
        background-size: 8px 8px, 8px 8px, auto !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="pixel"][data-sgb-theme="light"] [data-sgb-bubble="chat"] {
        background-color: rgba(255,255,255,.52) !important;
        border-color: rgba(92, 97, 122, .28) !important;
        box-shadow: 3px 3px 0 rgba(92,97,122,.14), inset 0 0 0 1px rgba(255,255,255,.26) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="pixel"][data-sgb-theme="light"] [data-sgb-input-box],
      html.${CLS_ACTIVE}[data-sgb-ui-style="pixel"][data-sgb-theme="light"] [data-sgb-suggestion-button] {
        background-color: rgba(255,255,255,.70) !important;
        border-color: rgba(92, 97, 122, .28) !important;
        background-image:
          linear-gradient(90deg, rgba(90,96,125,.045) 1px, transparent 1px),
          linear-gradient(180deg, rgba(90,96,125,.045) 1px, transparent 1px),
          linear-gradient(180deg, rgba(255,255,255,.34), rgba(255,255,255,.12)) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="pixel"] [data-sgb-top-glass-shell] {
        border-radius: 6px !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="pixel"] [data-sgb-top-glass-shell]::before {
        border-radius: 6px;
        border-width: 1.5px;
        box-shadow: 3px 3px 0 rgba(0,0,0,.16);
      }


      html.${CLS_ACTIVE}[data-sgb-ui-style="sticker"] [data-sgb-bubble="chat"],
      html.${CLS_ACTIVE}[data-sgb-ui-style="sticker"] [data-sgb-input-box],
      html.${CLS_ACTIVE}[data-sgb-ui-style="sticker"] [data-sgb-suggestion-button] {
        border-radius: 20px !important;
        border: 1px solid rgba(255,255,255,.44) !important;
        outline: 2px solid rgba(255,255,255,.12) !important;
        outline-offset: 2px !important;
        background-color: rgba(32, 31, 44, var(--sgb-ui-soft-alpha,.36)) !important;
        background-image:
          radial-gradient(circle at 18px 16px, rgba(255,255,255,.075) 0 2px, transparent 2.5px),
          linear-gradient(180deg, rgba(255,255,255,.13), rgba(255,255,255,.025)) !important;
        background-size: 26px 26px, auto !important;
        box-shadow:
          0 10px 0 rgba(255,255,255,.055),
          0 18px 42px rgba(0,0,0,.18),
          inset 0 1px 0 rgba(255,255,255,.16) !important;
        backdrop-filter: blur(calc(var(--sgb-glass-blur, 12px) * .35)) saturate(1.03) !important;
        -webkit-backdrop-filter: blur(calc(var(--sgb-glass-blur, 12px) * .35)) saturate(1.03) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="sticker"] [data-sgb-bubble="chat"] {
        border-bottom-color: rgba(var(--sgb-dialogue-rgb,255,199,222),.44) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="sticker"] [data-sgb-input-box] {
        border-radius: 18px !important;
        border-bottom-color: rgba(var(--sgb-thought-rgb,190,226,255),.46) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="sticker"] [data-sgb-suggestion-button] {
        border-radius: 999px !important;
        border-bottom-color: rgba(var(--sgb-italic-rgb,255,230,160),.48) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="sticker"][data-sgb-theme="light"] [data-sgb-bubble="chat"],
      html.${CLS_ACTIVE}[data-sgb-ui-style="sticker"][data-sgb-theme="light"] [data-sgb-input-box],
      html.${CLS_ACTIVE}[data-sgb-ui-style="sticker"][data-sgb-theme="light"] [data-sgb-suggestion-button] {
        background-color: rgba(255,255,255,.62) !important;
        border-color: rgba(255,255,255,.72) !important;
        outline-color: rgba(88, 95, 125, .10) !important;
        box-shadow:
          0 10px 0 rgba(255,255,255,.18),
          0 18px 42px rgba(70,65,100,.12),
          inset 0 1px 0 rgba(255,255,255,.36) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="sticker"] [data-sgb-top-glass-shell]::before {
        background:
          radial-gradient(circle at 18px 15px, rgba(255,255,255,.08) 0 2px, transparent 2.5px),
          linear-gradient(180deg, rgba(255,255,255,.18), rgba(255,255,255,.045)),
          rgba(32, 31, 44, .22);
        background-size: 24px 24px, auto, auto;
        border-color: rgba(255,255,255,.32);
        box-shadow: 0 10px 0 rgba(255,255,255,.045), 0 12px 26px rgba(0,0,0,.13);
      }

      /* Sticker v1.4.4: 땡땡이 배경만 팔레트색을 따라가게 */
      html.${CLS_ACTIVE}[data-sgb-ui-style="sticker"] [data-sgb-bubble="chat"]{
        background-image:
          radial-gradient(circle at 18px 16px, rgba(var(--sgb-dialogue-rgb,255,190,214),.14) 0 2px, transparent 2.5px),
          linear-gradient(180deg, rgba(255,255,255,.13), rgba(255,255,255,.025)) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="sticker"] [data-sgb-input-box]{
        background-image:
          radial-gradient(circle at 18px 16px, rgba(var(--sgb-thought-rgb,188,222,255),.14) 0 2px, transparent 2.5px),
          linear-gradient(180deg, rgba(255,255,255,.13), rgba(255,255,255,.025)) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="sticker"] [data-sgb-suggestion-button]{
        background-image:
          radial-gradient(circle at 18px 16px, rgba(var(--sgb-italic-rgb,255,224,165),.15) 0 2px, transparent 2.5px),
          linear-gradient(180deg, rgba(255,255,255,.13), rgba(255,255,255,.025)) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="sticker"] [data-sgb-top-glass-shell]::before{
        background:
          radial-gradient(circle at 18px 15px, rgba(var(--sgb-dialogue-rgb,255,190,214),.15) 0 2px, transparent 2.5px),
          linear-gradient(180deg, rgba(255,255,255,.18), rgba(255,255,255,.045)),
          rgba(32, 31, 44, .22) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="candy"] [data-sgb-bubble="chat"],
      html.${CLS_ACTIVE}[data-sgb-ui-style="candy"] [data-sgb-input-box],
      html.${CLS_ACTIVE}[data-sgb-ui-style="candy"] [data-sgb-suggestion-button] {
        border: 1px solid rgba(255,255,255,.36) !important;
        background-color: rgba(31, 32, 44, var(--sgb-ui-soft-alpha,.28)) !important;
        background-image:
          linear-gradient(180deg, rgba(255,255,255,.22), rgba(255,255,255,.055) 42%, rgba(255,255,255,.018)),
          linear-gradient(135deg, rgba(var(--sgb-dialogue-rgb,255,191,205),.18), rgba(255,255,255,.05) 34%, rgba(var(--sgb-thought-rgb,180,224,255),.14) 70%, rgba(var(--sgb-italic-rgb,255,233,173),.14));
        box-shadow:
          inset 0 2px 0 rgba(255,255,255,.18),
          inset 0 -2px 0 rgba(255,255,255,.04),
          0 12px 28px rgba(0,0,0,.13) !important;
        backdrop-filter: blur(calc(var(--sgb-glass-blur, 12px) * .46)) saturate(1.08) !important;
        -webkit-backdrop-filter: blur(calc(var(--sgb-glass-blur, 12px) * .46)) saturate(1.08) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="candy"] [data-sgb-bubble="chat"] {
        border-radius: 28px !important;
        border-bottom-width: 2px !important;
        border-bottom-color: rgba(var(--sgb-dialogue-rgb,255,198,212),.56) !important;
        box-shadow:
          inset 0 2px 0 rgba(255,255,255,.18),
          inset 0 -2px 0 rgba(255,255,255,.04),
          0 12px 28px rgba(0,0,0,.13),
          0 0 0 1px rgba(var(--sgb-dialogue-rgb,255,190,205),.18),
          0 0 16px rgba(var(--sgb-dialogue-rgb,255,190,205),.04) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="candy"] [data-sgb-input-box] {
        border-radius: 24px !important;
        border-bottom-width: 2px !important;
        border-bottom-color: rgba(var(--sgb-thought-rgb,176,224,255),.58) !important;
        box-shadow:
          inset 0 2px 0 rgba(255,255,255,.20),
          inset 0 -2px 0 rgba(255,255,255,.05),
          0 0 0 1px rgba(var(--sgb-thought-rgb,178,222,255),.18),
          0 12px 28px rgba(0,0,0,.13) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="candy"] [data-sgb-suggestion-button] {
        border-radius: 999px !important;
        border-bottom-width: 2px !important;
        border-bottom-color: rgba(var(--sgb-italic-rgb,255,228,158),.60) !important;
        box-shadow:
          inset 0 2px 0 rgba(255,255,255,.20),
          inset 0 -2px 0 rgba(255,255,255,.05),
          0 0 0 1px rgba(var(--sgb-italic-rgb,255,231,170),.20),
          0 10px 22px rgba(0,0,0,.11) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="candy"][data-sgb-theme="light"] [data-sgb-bubble="chat"],
      html.${CLS_ACTIVE}[data-sgb-ui-style="candy"][data-sgb-theme="light"] [data-sgb-input-box],
      html.${CLS_ACTIVE}[data-sgb-ui-style="candy"][data-sgb-theme="light"] [data-sgb-suggestion-button] {
        background-color: rgba(255,255,255,.68) !important;
        border-color: rgba(255,255,255,.80) !important;
        background-image:
          linear-gradient(180deg, rgba(255,255,255,.32), rgba(255,255,255,.12) 42%, rgba(255,255,255,.06)),
          linear-gradient(135deg, rgba(255, 191, 205, .20), rgba(255,255,255,.10) 34%, rgba(180, 224, 255, .17) 70%, rgba(255, 233, 173, .18));
        box-shadow:
          inset 0 2px 0 rgba(255,255,255,.34),
          inset 0 -2px 0 rgba(255,255,255,.10),
          0 12px 28px rgba(90, 95, 128, .10) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="candy"] [data-sgb-top-glass-shell] {
        border-radius: 999px !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="candy"] [data-sgb-top-glass-shell]::before {
        border-radius: 999px;
        background:
          linear-gradient(180deg, rgba(255,255,255,.24), rgba(255,255,255,.06) 44%, rgba(255,255,255,.02)),
          linear-gradient(135deg, rgba(255, 191, 205, .18), rgba(255,255,255,.06) 34%, rgba(180, 224, 255, .14) 70%, rgba(255, 233, 173, .12)),
          rgba(31, 32, 44, .22);
        border-color: rgba(255,255,255,.32);
        box-shadow:
          inset 0 2px 0 rgba(255,255,255,.18),
          inset 0 -2px 0 rgba(255,255,255,.04),
          0 10px 22px rgba(0,0,0,.11);
        backdrop-filter: blur(calc(var(--sgb-glass-blur, 12px) * .46)) saturate(1.08);
        -webkit-backdrop-filter: blur(calc(var(--sgb-glass-blur, 12px) * .46)) saturate(1.08);
      }

      /* ===== Borderless UI: 채팅 말풍선만 무테/투명 처리 ===== */
      html.${CLS_ACTIVE}[data-sgb-ui-style="borderless"] [data-sgb-bubble="chat"] {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        border: 1px solid transparent !important;
        outline: none !important;
        box-shadow: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="borderless"][data-sgb-theme="light"] [data-sgb-bubble="chat"],
      html.${CLS_ACTIVE}[data-sgb-ui-style="borderless"][data-sgb-theme="dark"] [data-sgb-bubble="chat"] {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        border-color: transparent !important;
        box-shadow: none !important;
      }

      /* 라디오존데 스킨: #igx-live-popup 루트의 위치/전환 속성은 건드리지 않는다. */
      html.${CLS_ACTIVE} #igx-live-popup[data-sgb-radiosonde-skin] {
        border-color: rgba(255,255,255,.18) !important;
        background: rgba(20,20,20,var(--sgb-ui-soft-alpha,.28)) !important;
        box-shadow: 0 12px 34px rgba(0,0,0,.20) !important;
        backdrop-filter: blur(calc(var(--sgb-glass-blur, 12px) * .44)) saturate(1.04) !important;
        -webkit-backdrop-filter: blur(calc(var(--sgb-glass-blur, 12px) * .44)) saturate(1.04) !important;
      }

      html.${CLS_ACTIVE} #igx-live-popup.inline[data-sgb-radiosonde-skin] {
        background: transparent !important;
        border-color: transparent !important;
        box-shadow: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }

      html.${CLS_ACTIVE} #igx-live-popup[data-sgb-radiosonde-skin] #igx-live-head,
      html.${CLS_ACTIVE} #igx-live-popup[data-sgb-radiosonde-skin] [data-sgb-radiosonde-head] {
        border-radius: 999px !important;
        background: rgba(20,20,20,.20) !important;
        border: 1px solid rgba(255,255,255,.12) !important;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.07) !important;
      }

      /* 라디오존데의 수치 텍스트(.bitem)는 배경을 칠하지 않는다. 글씨 뒤에 색이 생기는 문제 방지. */
      html.${CLS_ACTIVE} #igx-live-popup[data-sgb-radiosonde-skin] .bitem {
        background: transparent !important;
        border-color: transparent !important;
        box-shadow: none !important;
      }

      html.${CLS_ACTIVE} #igx-live-popup[data-sgb-radiosonde-skin] .igx-btn {
        background: rgba(255,255,255,.055) !important;
        border-color: rgba(255,255,255,.12) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="pixel"] #igx-live-popup[data-sgb-radiosonde-skin] #igx-live-head,
      html.${CLS_ACTIVE}[data-sgb-ui-style="pixel"] #igx-live-popup[data-sgb-radiosonde-skin] .igx-btn {
        border-radius: 4px !important;
        border-width: 1.5px !important;
        box-shadow: 2px 2px 0 rgba(0,0,0,.16), inset 0 0 0 1px rgba(255,255,255,.04) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="pixel"] #igx-live-popup[data-sgb-radiosonde-skin] .bitem {
        background: transparent !important;
        border-color: transparent !important;
        box-shadow: none !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="sticker"] #igx-live-popup[data-sgb-radiosonde-skin] #igx-live-head,
      html.${CLS_ACTIVE}[data-sgb-ui-style="sticker"] #igx-live-popup[data-sgb-radiosonde-skin] .igx-btn {
        border-radius: 999px !important;
        border-color: rgba(255,255,255,.26) !important;
        outline: 1px solid rgba(255,255,255,.10) !important;
        outline-offset: 1px !important;
        background:
          radial-gradient(circle at 12px 10px, rgba(255,255,255,.07) 0 1.5px, transparent 2px),
          rgba(255,255,255,.055) !important;
        background-size: 18px 18px, auto !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="sticker"] #igx-live-popup[data-sgb-radiosonde-skin] .bitem {
        background: transparent !important;
        border-color: transparent !important;
        box-shadow: none !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="candy"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline) {
        background: rgba(18, 20, 28, var(--sgb-ui-soft-alpha,.16)) !important;
        border-color: rgba(255,255,255,.10) !important;
        box-shadow: 0 8px 18px rgba(0,0,0,.10) !important;
        backdrop-filter: blur(calc(var(--sgb-glass-blur, 12px) * .22)) saturate(1.02) !important;
        -webkit-backdrop-filter: blur(calc(var(--sgb-glass-blur, 12px) * .22)) saturate(1.02) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="candy"] #igx-live-popup[data-sgb-radiosonde-skin] #igx-live-head,
      html.${CLS_ACTIVE}[data-sgb-ui-style="candy"] #igx-live-popup[data-sgb-radiosonde-skin] .igx-btn {
        border-radius: 999px !important;
        border: 1px solid rgba(255,255,255,.20) !important;
        background:
          linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,.04) 46%, rgba(255,255,255,.015)),
          linear-gradient(135deg, rgba(255, 191, 205, .09), rgba(255,255,255,.035) 34%, rgba(180, 224, 255, .07) 70%, rgba(255, 233, 173, .07)),
          rgba(255,255,255,.025) !important;
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.11),
          inset 0 -1px 0 rgba(255,255,255,.025),
          0 4px 10px rgba(0,0,0,.07) !important;
        backdrop-filter: blur(calc(var(--sgb-glass-blur, 12px) * .24)) saturate(1.03) !important;
        -webkit-backdrop-filter: blur(calc(var(--sgb-glass-blur, 12px) * .24)) saturate(1.03) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="candy"] #igx-live-popup[data-sgb-radiosonde-skin] .bitem {
        background: transparent !important;
        border-color: transparent !important;
        box-shadow: none !important;
      }

      /* 다른 확프/보조 UI는 절대 색을 바꾸지 않음. 이전 버전 마커가 남아 있어도 무효화. */
      html.${CLS_ACTIVE} [data-sgb-live-ui] {
        background: revert !important;
        background-color: revert !important;
        background-image: revert !important;
        border-color: revert !important;
        color: revert !important;
        box-shadow: revert !important;
        backdrop-filter: revert !important;
        -webkit-backdrop-filter: revert !important;
      }

      #${SGB_UI_IDS.row} {
        border-radius: 0;
      }

      #${SGB_UI_IDS.row} > [data-sgb-settings-open] {
        border-radius: 0;
        padding: 0;
        background: transparent !important;
        box-shadow: none !important;
      }

      /* 크랙 순정 switch 클래스와 통일. Tailwind data-state가 못 먹는 환경용 최소 fallback만 둔다. */
      #${SGB_UI_IDS.row} [data-sgb-toggle-switch],
      #${SGB_UI_IDS.modal} [data-sgb-modal-toggle] {
        box-sizing: border-box;
        width: 36px;
        height: 20px;
      }

      #${SGB_UI_IDS.row} [data-sgb-toggle-thumb],
      #${SGB_UI_IDS.modal} [data-sgb-modal-toggle-thumb] {
        width: 16px;
        height: 16px;
      }

      #${SGB_UI_IDS.row} [data-sgb-toggle-thumb][data-state="checked"],
      #${SGB_UI_IDS.modal} [data-sgb-modal-toggle-thumb][data-state="checked"] {
        transform: translateX(15px);
      }

      #${SGB_UI_IDS.row} [data-sgb-toggle-thumb][data-state="unchecked"],
      #${SGB_UI_IDS.modal} [data-sgb-modal-toggle-thumb][data-state="unchecked"] {
        transform: translateX(-1px);
      }

      #${SGB_UI_IDS.modal} {
        position: fixed;
        inset: 0;
        display: none;
        z-index: 2147483600;
        pointer-events: none;
        font-family: Pretendard, "Apple SD Gothic Neo", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #${SGB_UI_IDS.modal}[data-open="true"] {
        display: block;
        pointer-events: auto;
      }

      #${SGB_UI_IDS.modal} .sgb-settings-panel {
        position: absolute;
        right: 24px;
        bottom: 24px;
        width: min(380px, calc(100vw - 32px));
        max-height: min(660px, calc(100vh - 48px));
        display: flex;
        flex-direction: column;
        overflow: hidden;
        color: rgba(244,247,255,.94);
        background:
          linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,.035)),
          rgba(18,21,32,.82);
        border: 1px solid rgba(205,216,255,.22);
        border-radius: 18px;
        box-shadow: 0 24px 80px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.12);
        touch-action: manipulation;
      }

      #${SGB_UI_IDS.modal} .sgb-settings-header,
      #${SGB_UI_IDS.modal} .sgb-settings-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px;
        border-color: rgba(205,216,255,.16);
      }

      #${SGB_UI_IDS.modal} .sgb-settings-header {
        border-bottom: 1px solid rgba(205,216,255,.16);
      }

      #${SGB_UI_IDS.modal} .sgb-settings-footer {
        border-top: 1px solid rgba(205,216,255,.16);
      }

      #${SGB_UI_IDS.modal} .sgb-settings-header strong {
        display: block;
        font-size: 15px;
        line-height: 1.2;
      }

      #${SGB_UI_IDS.modal} .sgb-settings-header p {
        margin: 4px 0 0;
        font-size: 12px;
        color: rgba(220,226,238,.68);
      }

      #${SGB_UI_IDS.modal} .sgb-settings-close {
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 999px;
        cursor: pointer;
        color: inherit;
        background: rgba(255,255,255,.08);
        font-size: 20px;
        line-height: 1;
      }

      #${SGB_UI_IDS.modal} .sgb-settings-body {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 14px 16px 16px;
        overflow-y: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        touch-action: pan-y;
      }

      #${SGB_UI_IDS.modal} .sgb-settings-enable {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(255,255,255,.06);
        border: 1px solid rgba(255,255,255,.10);
        font-size: 13px;
        font-weight: 700;
      }

      #${SGB_UI_IDS.modal} .sgb-settings-toggle-row {
        align-items: flex-start;
      }

      #${SGB_UI_IDS.modal} .sgb-settings-toggle-row > span {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
      }

      #${SGB_UI_IDS.modal} .sgb-settings-toggle-row strong {
        font-size: 12px;
        font-weight: 800;
        color: rgba(244,247,255,.94);
      }

      #${SGB_UI_IDS.modal} .sgb-settings-toggle-row small {
        font-size: 11px;
        line-height: 1.45;
        color: rgba(222,230,244,.72);
      }

      #${SGB_UI_IDS.modal} .sgb-shadow-tone-control {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 10px;
        border-radius: 12px;
        background: rgba(255,255,255,.045);
        border: 1px solid rgba(255,255,255,.09);
      }

      #${SGB_UI_IDS.modal} .sgb-shadow-tone-label {
        font-size: 12px;
        font-weight: 800;
        color: rgba(244,247,255,.88);
      }

      #${SGB_UI_IDS.modal} .sgb-shadow-tone-options {
        display: inline-flex;
        gap: 6px;
      }

      #${SGB_UI_IDS.modal} .sgb-shadow-tone-option {
        min-width: 44px;
        height: 28px;
        padding: 0 10px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,.14);
        background: rgba(255,255,255,.06);
        color: rgba(244,247,255,.86);
        font-size: 12px;
        font-weight: 800;
        cursor: pointer;
      }

      #${SGB_UI_IDS.modal} .sgb-shadow-tone-option[data-selected="true"] {
        border-color: rgba(255, 99, 1, .55);
        background: rgba(255, 99, 1, .18);
        color: #fff;
      }

      #${SGB_UI_IDS.modal} .sgb-settings-control {
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-size: 12px;
      }

      /* 설정 섹션 = 접히는 카드 (처음 열면 카테고리만 깔끔히) */
      #${SGB_UI_IDS.modal} .sgb-settings-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding-top: 14px;
        margin-top: 2px;
        border-top: 1px solid rgba(205,216,255,.14);
      }

      #${SGB_UI_IDS.modal} .sgb-settings-section-title {
        font-size: 12px;
        font-weight: 800;
        color: rgba(244,247,255,.92);
      }


      #${SGB_UI_IDS.modal} details.sgb-settings-section {
        display: flex;
        flex-direction: column;
      }

      #${SGB_UI_IDS.modal} details.sgb-settings-section > summary {
        list-style: none;
        cursor: pointer;
        user-select: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-height: 28px;
        padding: 0;
        color: rgba(244,247,255,.92);
      }

      #${SGB_UI_IDS.modal} details.sgb-settings-section > summary::-webkit-details-marker {
        display: none;
      }

      #${SGB_UI_IDS.modal} .sgb-settings-fold-title {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-size: 12px;
        font-weight: 900;
        letter-spacing: -.1px;
      }

      #${SGB_UI_IDS.modal} .sgb-settings-fold-title::before {
        content: "›";
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border-radius: 999px;
        background: rgba(255,255,255,.075);
        border: 1px solid rgba(255,255,255,.11);
        color: rgba(244,247,255,.78);
        font-size: 14px;
        line-height: 1;
        transform: rotate(0deg);
        transition: transform .16s ease;
      }

      #${SGB_UI_IDS.modal} details.sgb-settings-section[open] .sgb-settings-fold-title::before {
        transform: rotate(90deg);
      }

      #${SGB_UI_IDS.modal} .sgb-settings-fold-hint {
        font-size: 10px;
        color: rgba(244,247,255,.42);
        font-weight: 700;
      }

      #${SGB_UI_IDS.modal} details.sgb-settings-section[open] .sgb-settings-fold-hint::before {
        content: "접기";
      }

      #${SGB_UI_IDS.modal} details.sgb-settings-section:not([open]) .sgb-settings-fold-hint::before {
        content: "펼치기";
      }

      #${SGB_UI_IDS.modal} .sgb-settings-fold-body {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding-top: 10px;
      }

      #${SGB_UI_IDS.modal} .sgb-color-control {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        font-size: 12px;
      }

      #${SGB_UI_IDS.modal} .sgb-color-control-inputs {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      #${SGB_UI_IDS.modal} input[type="color"] {
        width: 34px;
        height: 28px;
        padding: 0;
        border: 1px solid rgba(255,255,255,.18);
        border-radius: 8px;
        background: rgba(255,255,255,.06);
        cursor: pointer;
      }

      #${SGB_UI_IDS.modal} input[data-sgb-color-code] {
        width: 82px;
        height: 28px;
        box-sizing: border-box;
        padding: 0 8px;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 8px;
        outline: none;
        color: rgba(244,247,255,.94);
        background: rgba(255,255,255,.07);
        font-size: 12px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }

      #${SGB_UI_IDS.modal} input[data-sgb-color-code]:focus {
        border-color: rgba(255,255,255,.38);
        background: rgba(255,255,255,.10);
      }

      #${SGB_UI_IDS.modal} .sgb-font-select,
      #${SGB_UI_IDS.modal} .sgb-font-field :is(input, textarea, select) {
        width: 100%;
        min-height: 32px;
        box-sizing: border-box;
        padding: 0 10px;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 9px;
        outline: none;
        color: rgba(244,247,255,.94);
        background: rgba(255,255,255,.075);
        font-size: 12px;
        cursor: pointer;
      }

      #${SGB_UI_IDS.modal} .sgb-font-select:focus,
      #${SGB_UI_IDS.modal} .sgb-font-field :is(input, textarea, select):focus {
        border-color: rgba(255,255,255,.38);
        background: rgba(255,255,255,.11);
      }

      #${SGB_UI_IDS.modal} .sgb-font-select option {
        color: #111;
        background: #fff;
      }

      #${SGB_UI_IDS.modal} .sgb-font-direct {
        gap: 9px;
      }

      #${SGB_UI_IDS.modal} .sgb-font-field {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }

      #${SGB_UI_IDS.modal} .sgb-font-field span,
      #${SGB_UI_IDS.modal} .sgb-font-help {
        font-size: 10.5px;
        line-height: 1.35;
        color: rgba(221,228,245,.62);
      }

      #${SGB_UI_IDS.modal} .sgb-font-field :is(input, textarea, select) {
        width: 100%;
        cursor: text;
      }


      #${SGB_UI_IDS.modal} .sgb-font-field textarea {
        min-height: 72px;
        padding-top: 8px;
        padding-bottom: 8px;
        resize: vertical;
        line-height: 1.35;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        white-space: pre-wrap;
      }

      #${SGB_UI_IDS.modal} .sgb-font-field select {
        height: 34px;
        cursor: pointer;
      }

      #${SGB_UI_IDS.modal} .sgb-font-help {
        display: block;
      }

      #${SGB_UI_IDS.modal} .sgb-font-library-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 7px;
      }

      #${SGB_UI_IDS.modal} .sgb-font-library-actions :is(button, .sgb-font-file-button) {
        min-height: 32px;
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 10px;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 9px;
        color: rgba(244,247,255,.88);
        background: rgba(255,255,255,.075);
        font-size: 11px;
        line-height: 1;
        cursor: pointer;
      }

      #${SGB_UI_IDS.modal} .sgb-font-library-actions :is(button, .sgb-font-file-button):hover {
        border-color: rgba(255,255,255,.30);
        background: rgba(255,255,255,.12);
      }

      #${SGB_UI_IDS.modal} .sgb-font-file-button input {
        display: none !important;
      }

      #${SGB_UI_IDS.modal} .sgb-settings-control-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      #${SGB_UI_IDS.modal} .sgb-style-options {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      #${SGB_UI_IDS.modal} .sgb-style-option {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-height: 52px;
        padding: 9px 10px;
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 12px;
        color: inherit;
        background: rgba(255,255,255,.055);
        cursor: pointer;
        text-align: left;
      }

      #${SGB_UI_IDS.modal} .sgb-style-option:hover {
        background: rgba(255,255,255,.09);
        border-color: rgba(255,255,255,.24);
      }

      #${SGB_UI_IDS.modal} .sgb-style-option[data-selected="true"] {
        background: rgba(255, 99, 1, .16);
        border-color: rgba(255, 140, 82, .48);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 0 0 1px rgba(255, 99, 1, .12);
      }

      #${SGB_UI_IDS.modal} .sgb-style-name {
        font-size: 12px;
        font-weight: 800;
        line-height: 1.15;
      }

      #${SGB_UI_IDS.modal} .sgb-style-line {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        min-width: 0;
      }

      #${SGB_UI_IDS.modal} .sgb-style-palette {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        flex: none;
      }

      #${SGB_UI_IDS.modal} .sgb-style-chip {
        width: 15px;
        height: 15px;
        flex: 0 0 15px;
        box-sizing: border-box;
        padding: 0;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,.42);
        background:
          linear-gradient(135deg, var(--sgb-chip-color, #fff) 0 48%, var(--sgb-chip-color-2, var(--sgb-chip-color, #fff)) 48% 72%, var(--sgb-chip-color-3, var(--sgb-chip-color, #fff)) 72% 100%);
        box-shadow: 0 1px 3px rgba(0,0,0,.30), inset 0 1px 0 rgba(255,255,255,.22);
        cursor: pointer;
      }

      #${SGB_UI_IDS.modal} .sgb-style-chip-base {
        width: 16px;
        height: 16px;
        flex-basis: 16px;
        border-color: rgba(255,255,255,.68);
      }

      #${SGB_UI_IDS.modal} .sgb-style-chip:hover {
        transform: translateY(-1px);
        border-color: rgba(255,255,255,.72);
      }

      #${SGB_UI_IDS.modal} .sgb-style-chip[data-selected="true"] {
        outline: 2px solid rgba(255, 140, 82, .60);
        outline-offset: 2px;
      }

      #${SGB_UI_IDS.modal} .sgb-style-desc {
        font-size: 10px;
        line-height: 1.25;
        color: rgba(220,226,238,.62);
      }
      /* ===== 설정 모달 탭 레이아웃 (v1.4 개편) ===== */
      #${SGB_UI_IDS.modal} .sgb-settings-panel > .sgb-settings-enable {
        margin: 12px 16px 0;
      }
      #${SGB_UI_IDS.modal} .sgb-tabs {
        display: flex;
        gap: 4px;
        margin: 12px 16px 0;
        padding: 4px;
        border-radius: 12px;
        background: rgba(0,0,0,.24);
        border: 1px solid rgba(255,255,255,.07);
      }
      #${SGB_UI_IDS.modal} .sgb-tab {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 34px;
        border: 0;
        border-radius: 9px;
        background: transparent;
        color: rgba(222,230,244,.72);
        font-size: 12.5px;
        font-weight: 800;
        cursor: pointer;
        transition: background .14s ease, color .14s ease;
      }
      #${SGB_UI_IDS.modal} .sgb-tab:hover {
        color: rgba(244,247,255,.94);
        background: rgba(255,255,255,.05);
      }
      #${SGB_UI_IDS.modal} .sgb-tab[data-selected="true"] {
        color: #fff;
        background: linear-gradient(180deg, rgba(255,99,1,.30), rgba(255,99,1,.20));
        box-shadow: inset 0 0 0 1px rgba(255,140,82,.42), 0 4px 10px rgba(255,99,1,.14);
      }
      #${SGB_UI_IDS.modal} .sgb-tab svg {
        width: 15px;
        height: 15px;
        opacity: .9;
      }
      #${SGB_UI_IDS.modal} .sgb-pane {
        display: none;
        flex-direction: column;
        gap: 12px;
      }
      #${SGB_UI_IDS.modal} .sgb-pane[data-selected="true"] {
        display: flex;
      }
      #${SGB_UI_IDS.modal} .sgb-sub {
        display: flex;
        align-items: center;
        gap: 7px;
        margin: 2px 0 -2px;
        font-size: 11px;
        font-weight: 900;
        letter-spacing: .2px;
        color: rgba(244,247,255,.5);
      }
      #${SGB_UI_IDS.modal} .sgb-sub::after {
        content: "";
        flex: 1;
        height: 1px;
        background: rgba(205,216,255,.16);
      }
      #${SGB_UI_IDS.modal} .sgb-hl-card {
        border-radius: 13px;
        background: rgba(255,255,255,.05);
        border: 1px solid rgba(255,255,255,.08);
        overflow: hidden;
      }
      #${SGB_UI_IDS.modal} .sgb-hl-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
      }
      #${SGB_UI_IDS.modal} .sgb-hl-top > span {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
      }
      #${SGB_UI_IDS.modal} .sgb-hl-top strong {
        font-size: 12px;
        font-weight: 800;
        color: rgba(244,247,255,.94);
      }
      #${SGB_UI_IDS.modal} .sgb-hl-top small {
        font-size: 11px;
        line-height: 1.4;
        color: rgba(222,230,244,.72);
      }
      #${SGB_UI_IDS.modal} .sgb-hl-colors {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px 12px 11px;
        border-top: 1px solid rgba(255,255,255,.06);
      }
      #${SGB_UI_IDS.modal} .sgb-hl-card:has([data-sgb-bool-toggle][data-state="unchecked"]) {
        opacity: .72;
      }
      #${SGB_UI_IDS.modal} .sgb-hl-card:has([data-sgb-bool-toggle][data-state="unchecked"]) .sgb-hl-colors {
        display: none;
      }



      #${SGB_UI_IDS.modal} .sgb-highlight-shape-control {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 12px;
        background: rgba(255,255,255,.045);
        border: 1px solid rgba(255,255,255,.09);
      }

      #${SGB_UI_IDS.modal} .sgb-highlight-shape-options {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px;
      }

      #${SGB_UI_IDS.modal} .sgb-highlight-shape-option {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        min-height: 32px;
        padding: 0 7px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,.14);
        background: rgba(255,255,255,.06);
        color: rgba(244,247,255,.86);
        font-size: 11px;
        font-weight: 800;
        cursor: pointer;
        white-space: nowrap;
      }

      #${SGB_UI_IDS.modal} .sgb-highlight-shape-option:hover {
        background: rgba(255,255,255,.10);
        border-color: rgba(255,255,255,.24);
      }

      #${SGB_UI_IDS.modal} .sgb-highlight-shape-option[data-selected="true"] {
        border-color: rgba(255, 140, 82, .52);
        background: rgba(255, 99, 1, .18);
        color: #fff;
      }

      #${SGB_UI_IDS.modal} .sgb-shape-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        height: 18px;
        border-radius: 6px;
        background: rgba(255,255,255,.075);
        border: 1px solid rgba(255,255,255,.10);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11px;
        line-height: 1;
      }

      #${SGB_UI_IDS.modal} .sgb-shape-label {
        min-width: 0;
      }

      #${SGB_UI_IDS.modal} output {
        min-width: 48px;
        text-align: right;
        color: rgba(220,226,238,.72);
        font-variant-numeric: tabular-nums;
      }

      #${SGB_UI_IDS.modal} input[type="range"] {
        width: 100%;
        accent-color: var(--primary, rgb(255, 99, 1));
      }

      #${SGB_UI_IDS.modal} .sgb-settings-footer button {
        min-width: 76px;
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,.16);
        color: inherit;
        background: rgba(255,255,255,.07);
        cursor: pointer;
      }

      #${SGB_UI_IDS.modal} .sgb-settings-footer button:hover,
      #${SGB_UI_IDS.modal} .sgb-settings-close:hover {
        background: rgba(255,255,255,.13);
      }

      /* 에리 로어 인젝터 호환:
         에리의 .burner-button / 메뉴 항목은 위치를 바꾸지 않고 배경 레이어보다 위에만 둔다. */
      .burner-button[data-sgb-eri-protected],
      #chasm-decentral-menu[data-sgb-eri-protected],
      #lore-inj-boot-error[data-sgb-eri-protected] {
        position: relative !important;
        z-index: 2147483000 !important;
        pointer-events: auto !important;
        visibility: visible !important;
        opacity: 1 !important;
      }

      .burner-button[data-sgb-eri-protected] {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
      }

      /* Scene Painter 이미지 클릭 확대 보호:
         caption overlay는 클릭을 먹으면 안 되고, 실제 img가 클릭 타깃이어야 함. */
      html.${CLS_ACTIVE} main .csp-generated-scene-image {
        pointer-events: auto !important;
      }

      html.${CLS_ACTIVE} main .csp-generated-scene-image > img {
        pointer-events: auto !important;
        cursor: zoom-in !important;
      }

      html.${CLS_ACTIVE} main .csp-generated-scene-caption {
        pointer-events: none !important;
      }

      html.${CLS_ACTIVE} main .csp-generated-scene-caption .csp-image-info-row,
      html.${CLS_ACTIVE} main .csp-generated-scene-caption .csp-image-action-row,
      html.${CLS_ACTIVE} main .csp-generated-scene-caption button {
        pointer-events: auto !important;
      }

      /* ===================================================================
         UI 테마 정리본 (cozy / codepad / najeon)
         - data-sgb-theme-colors="on"일 때만 추천 글자색/강조색을 적용한다.
         - off 상태에서는 사용자가 저장한 커스텀 색 변수(--sgb-*)가 그대로 살아난다.
         - UI 불투명도 하나로 --sgb-theme-surface-alpha와 --sgb-glass-blur를 같이 조절한다.
         - 하한을 0.18까지 낮춰 슬라이더를 내리면 실제 표면이 더 투명해진다.
         =================================================================== */

      /* ===== 🕯️ COZY — 종이 메모 카드 + 마스킹테이프 노트 (UI 불투명도 연동) ===== */
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"]{
        --cozy-ink:var(--sgb-readable-text,#4F3E2A);
        --cozy-muted:var(--sgb-muted-text,#7A5C39);
        --cozy-strong:var(--sgb-strong-text,#332416);
        --cozy-dialogue-text:var(--sgb-dialogue-text,#412B0F);
        --cozy-thought-text:var(--sgb-thought-text,#58452E);
        --cozy-tape-soft:rgba(207,168,110,.54);
        --cozy-alpha:var(--sgb-theme-surface-alpha,.86);
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"][data-sgb-theme-colors="on"]{
        --sgb-readable-text:#4F3E2A!important;
        --sgb-muted-text:#7A5C39!important;
        --sgb-strong-text:#332416!important;
        --sgb-italic-text:#7A5C39!important;
        --sgb-strong-highlight-text:#332416!important;
        --sgb-dialogue-rgb:221,184,103!important;
        --sgb-dialogue-text:#412B0F!important;
        --sgb-thought-rgb:216,198,169!important;
        --sgb-thought-text:#58452E!important;
        --sgb-italic-rgb:216,198,169!important;
        --sgb-strongbg-rgb:221,184,103!important;
        --sgb-code-rgb:215,202,178!important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-bubble="chat"]{
        position:relative!important;
        overflow:visible!important;
        margin-top:14px!important;
        padding:18px 20px!important;
        border-radius:10px!important;
        color:var(--cozy-ink)!important;
        background:
          linear-gradient(180deg, rgba(255,255,255,calc(var(--cozy-alpha) * .24)), rgba(255,255,255,0) 16%),
          radial-gradient(120% 80% at 8% 0%, rgba(246,228,197,calc(var(--cozy-alpha) * .30)), transparent 36%),
          repeating-linear-gradient(0deg, rgba(104,82,56,.014) 0 1px, rgba(255,255,255,0) 1px 5px),
          repeating-linear-gradient(90deg, rgba(104,82,56,.011) 0 1px, rgba(255,255,255,0) 1px 7px),
          linear-gradient(180deg, rgba(208,188,158,calc(var(--cozy-alpha) * .98)), rgba(189,167,135,calc(var(--cozy-alpha) * .98)))!important;
        border:1px solid rgba(191,165,129,calc(var(--cozy-alpha) * .78))!important;
        box-shadow:
          0 3px 10px rgba(76,56,34,.18),
          inset 0 1px 0 rgba(255,255,255,.72),
          inset 0 -1px 0 rgba(174,145,108,.28),
          inset 0 0 0 1px rgba(255,255,255,.18)!important;
        backdrop-filter:none!important;
        -webkit-backdrop-filter:none!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-bubble="chat"]::before{
        content:""!important;
        position:absolute!important;
        top:-11px!important;
        right:26px!important;
        width:58px!important;
        height:22px!important;
        border-radius:2px!important;
        background:
          repeating-linear-gradient(45deg, rgba(255,255,255,.18) 0 6px, rgba(255,255,255,.03) 6px 12px),
          rgba(230,207,171,.86)!important;
        box-shadow:0 1px 2px rgba(76,56,34,.14)!important;
        transform:rotate(4deg)!important;
        pointer-events:none!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-bubble="chat"]::after{
        content:""!important;
        position:absolute!important;
        top:-9px!important;
        left:36px!important;
        width:44px!important;
        height:16px!important;
        border-radius:2px!important;
        background:
          repeating-linear-gradient(45deg, rgba(255,255,255,.16) 0 6px, rgba(255,255,255,.03) 6px 12px),
          var(--cozy-tape-soft)!important;
        box-shadow:0 1px 2px rgba(76,56,34,.10)!important;
        transform:rotate(-8deg)!important;
        pointer-events:none!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-bubble="chat"] .wrtn-markdown{
        color:var(--cozy-ink)!important;
        filter:none!important;
        text-shadow:none!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"][data-sgb-text-shadow="on"] main [data-sgb-message-group] [data-sgb-bubble="chat"] .wrtn-markdown{
        filter:none!important;
        text-shadow:none!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-bubble="chat"] .wrtn-markdown :is(p,li,blockquote,h1,h2,h3,h4,h5,h6,strong,em){
        color:inherit!important;
        text-shadow:none!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-bubble="chat"] .wrtn-markdown p{
        margin-bottom:calc(var(--sgb-paragraph-spacing,.70rem) * 1.08)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-bubble="chat"] .wrtn-markdown p:last-child{
        margin-bottom:0!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-bubble="chat"] .wrtn-markdown :is(p,li,blockquote,h1,h2,h3,h4,h5,h6){
        padding-left:revert!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-bubble="chat"] .wrtn-markdown :is(p,li,blockquote,h1,h2,h3,h4,h5,h6)::before{
        content:none!important;
      }
      /* Cozy 기본 글자색 */
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] main .wrtn-markdown strong{
        color:var(--cozy-strong)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] main .wrtn-markdown em{
        color:var(--sgb-muted-text,var(--cozy-muted))!important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-suggestion-button],
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-input-box]{
        position:relative!important;
        overflow:hidden!important;
        border-radius:10px!important;
        background:
          linear-gradient(180deg, rgba(255,255,255,calc(var(--cozy-alpha) * .30)), rgba(255,255,255,0) 16%),
          repeating-linear-gradient(0deg, rgba(104,82,56,.016) 0 1px, rgba(255,255,255,0) 1px 5px),
          linear-gradient(180deg,rgba(242,228,206,calc(var(--cozy-alpha) * .98)),rgba(226,208,182,calc(var(--cozy-alpha) * .98)))!important;
        color:var(--cozy-ink)!important;
        border:1px solid rgba(191,165,129,calc(var(--cozy-alpha) * .76))!important;
        box-shadow:
          0 2px 8px rgba(76,56,34,.13),
          inset 0 1px 0 rgba(255,255,255,.72),
          inset 0 -1px 0 rgba(174,145,108,.22)!important;
        backdrop-filter:none!important;
        -webkit-backdrop-filter:none!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-suggestion-button]::before{
        content:""!important;
        position:absolute!important;
        top:-9px!important;
        right:20px!important;
        width:42px!important;
        height:16px!important;
        border-radius:2px!important;
        background:
          repeating-linear-gradient(45deg, rgba(255,255,255,.13) 0 6px, rgba(255,255,255,.03) 6px 12px),
          rgba(230,207,171,.72)!important;
        transform:rotate(6deg)!important;
        pointer-events:none!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-input-box]::before{content:none!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-input-box] .is-editor-empty:first-child:before{
        color:rgba(79,62,42,.54)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-input-box] .send{
        background:linear-gradient(120deg,#d8ad58,#bd9250)!important;
        color:#3b2812!important;
        box-shadow:none!important;
      }

      /* Cozy 코드블록: 내부는 더 진한 토프/그레이지, 헤더는 밝은 라벨톤으로 분리 */
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] main [data-sgb-codeblock]{
        overflow:hidden!important;
        border-radius:10px!important;
        border:1px solid rgba(148,138,121,calc(var(--cozy-alpha) * .76))!important;
        background:linear-gradient(180deg, rgba(135,113,82,calc(var(--cozy-alpha) * .90)), rgba(116,97,72,calc(var(--cozy-alpha) * .90)))!important;
        box-shadow:0 2px 8px rgba(76,56,34,.13)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] main [data-sgb-codeblock-head]{
        background:linear-gradient(180deg, rgba(220,199,169,calc(var(--cozy-alpha) * .98)), rgba(201,174,132,calc(var(--cozy-alpha) * .98)))!important;
        color:#4b3520!important;
        border-bottom:1px solid rgba(148,138,121,calc(var(--cozy-alpha) * .58))!important;
        text-shadow:none!important;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.34)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] main [data-sgb-codeblock-body]{
        background:
          linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,0) 18%),
          repeating-linear-gradient(0deg, rgba(255,255,255,.015) 0 1px, rgba(255,255,255,0) 1px 5px),
          linear-gradient(180deg, rgba(135,113,82,calc(var(--cozy-alpha) * .92)), rgba(116,97,72,calc(var(--cozy-alpha) * .92)))!important;
        color:#fff2dc!important;
        text-shadow:none!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] main [data-sgb-codeblock-body] *{
        background:transparent!important;
        color:#fff2dc!important;
        text-shadow:none!important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline){
        overflow:hidden!important;
        border-radius:12px!important;
        background:
          linear-gradient(180deg, rgba(255,255,255,calc(var(--cozy-alpha) * .28)), rgba(255,255,255,0) 15%),
          repeating-linear-gradient(0deg, rgba(104,82,56,.014) 0 1px, rgba(255,255,255,0) 1px 5px),
          linear-gradient(180deg,rgba(234,220,199,calc(var(--cozy-alpha) * .98)),rgba(221,204,179,calc(var(--cozy-alpha) * .98)))!important;
        color:var(--cozy-ink)!important;
        border:1px solid rgba(191,165,129,calc(var(--cozy-alpha) * .80))!important;
        box-shadow:0 3px 10px rgba(76,56,34,.14)!important;
        backdrop-filter:none!important;
        -webkit-backdrop-filter:none!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline)::before{content:none!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline),
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline) *{
        color:var(--cozy-ink)!important;
        opacity:1!important;
        text-shadow:none!important;
        filter:none!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] #igx-live-popup[data-sgb-radiosonde-skin] #igx-live-head,
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] #igx-live-popup[data-sgb-radiosonde-skin] .igx-btn{
        background:linear-gradient(180deg, rgba(220,199,169,calc(var(--cozy-alpha) * .98)), rgba(203,179,143,calc(var(--cozy-alpha) * .98)))!important;
        color:#523d25!important;
        border-color:rgba(191,165,129,calc(var(--cozy-alpha) * .78))!important;
        box-shadow:none!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline) #igx-live-head{
        border-radius:10px!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] #igx-live-popup[data-sgb-radiosonde-skin] .igx-btn{
        border-radius:999px!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] #igx-live-popup[data-sgb-radiosonde-skin] .igx-btn:hover{
        background:#ead2ad!important;
        border-color:rgba(216,173,88,.86)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline) .bitem{
        background:rgba(242,228,206,calc(var(--cozy-alpha) * .98))!important;
        border-color:rgba(191,165,129,calc(var(--cozy-alpha) * .68))!important;
        color:var(--cozy-ink)!important;
      }

      /* 이탤릭 배경/강조가 꺼져 있으면 Cozy가 임의로 기울이거나 색칠하지 않는다. */
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"][data-sgb-italic-bg="off"] main .wrtn-markdown em{
        font-style:normal!important;
        color:var(--sgb-muted-text,#7A5C39)!important;
        background:none!important;
        border:none!important;
        box-shadow:none!important;
        text-shadow:none!important;
      }

      /* Cozy 강조도 다른 테마처럼 공통 highlight 규칙을 탄다. 여기서는 글자색만 종이톤으로 맞춘다. */
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"][data-sgb-dialogue-bg="on"] main [data-sgb-message-group] [data-sgb-quote="double"]{
        color:var(--cozy-dialogue-text)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"][data-sgb-thought-bg="on"] main [data-sgb-message-group] [data-sgb-quote="single"]{
        color:var(--cozy-thought-text)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"][data-sgb-italic-bg="on"] main [data-sgb-message-group] .wrtn-markdown em{
        color:var(--sgb-italic-text,var(--cozy-muted))!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"][data-sgb-strong-bg="on"] main [data-sgb-message-group] .wrtn-markdown strong{
        color:var(--sgb-strong-highlight-text,var(--cozy-strong))!important;
      }


      /* Cozy 꾸밈: 발바닥은 제거하고, 넓은 간격의 잔잔한 체크감만 남긴다. */
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-bubble="chat"]{
        background:
          linear-gradient(180deg, rgba(255,255,255,calc(var(--cozy-alpha) * .30)), rgba(255,255,255,0) 16%),
          radial-gradient(120% 80% at 8% 0%, rgba(246,228,197,calc(var(--cozy-alpha) * .34)), transparent 36%),
          repeating-linear-gradient(0deg, rgba(104,82,56,.020) 0 1.2px, rgba(255,255,255,0) 1.2px 7px),
          repeating-linear-gradient(90deg, rgba(104,82,56,.016) 0 1.2px, rgba(255,255,255,0) 1.2px 9px),
          repeating-linear-gradient(0deg, rgba(191,165,129,.075) 0 1.4px, rgba(255,255,255,0) 1.4px 32px),
          repeating-linear-gradient(90deg, rgba(191,165,129,.060) 0 1.4px, rgba(255,255,255,0) 1.4px 32px),
          linear-gradient(180deg,rgba(234,220,199,calc(var(--cozy-alpha) * .98)),rgba(221,204,179,calc(var(--cozy-alpha) * .98)))!important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-suggestion-button],
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-input-box]{
        background:
          linear-gradient(180deg, rgba(255,255,255,calc(var(--cozy-alpha) * .24)), rgba(255,255,255,0) 16%),
          repeating-linear-gradient(0deg, rgba(104,82,56,.014) 0 1.1px, rgba(255,255,255,0) 1.1px 7px),
          repeating-linear-gradient(0deg, rgba(191,165,129,.060) 0 1.3px, rgba(255,255,255,0) 1.3px 28px),
          repeating-linear-gradient(90deg, rgba(191,165,129,.050) 0 1.3px, rgba(255,255,255,0) 1.3px 28px),
          linear-gradient(180deg,rgba(242,228,206,calc(var(--cozy-alpha) * .98)),rgba(226,208,182,calc(var(--cozy-alpha) * .98)))!important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline){
        background:
          linear-gradient(180deg, rgba(255,255,255,calc(var(--cozy-alpha) * .22)), rgba(255,255,255,0) 15%),
          repeating-linear-gradient(0deg, rgba(104,82,56,.012) 0 1.1px, rgba(255,255,255,0) 1.1px 7px),
          repeating-linear-gradient(0deg, rgba(191,165,129,.058) 0 1.3px, rgba(255,255,255,0) 1.3px 30px),
          repeating-linear-gradient(90deg, rgba(191,165,129,.048) 0 1.3px, rgba(255,255,255,0) 1.3px 30px),
          linear-gradient(180deg,rgba(234,220,199,calc(var(--cozy-alpha) * .98)),rgba(221,204,179,calc(var(--cozy-alpha) * .98)))!important;
      }

      /* Cozy 곰돌이 얼굴 (클로드 SVG 입 모양 적용, 왼쪽으로 이동) */
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-bubble="chat"]{
        overflow:visible!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-bubble="chat"] > .wrtn-markdown::before,
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-bubble="chat"] .wrtn-markdown:first-child::before{
        content:""!important;
        position:absolute!important;
        top:-31px!important;
        left:-18px!important;
        width:37px!important;
        height:37px!important;
        z-index:3!important;
        pointer-events:none!important;
        transform:rotate(-8deg)!important;
        filter:drop-shadow(0 3px 5px rgba(76,56,34,.24))!important;
        background-repeat:no-repeat!important;
        background-position:center!important;
        background-size:contain!important;
        background-image:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="13" cy="14" r="7" fill="%23e3c29a" stroke="%23b98f63" stroke-width="1.4"/><circle cx="35" cy="14" r="7" fill="%23e3c29a" stroke="%23b98f63" stroke-width="1.4"/><circle cx="13" cy="14" r="3.1" fill="%23f2b8c6"/><circle cx="35" cy="14" r="3.1" fill="%23f2b8c6"/><circle cx="24" cy="26" r="15" fill="%23e3c29a" stroke="%23b98f63" stroke-width="1.4"/><ellipse cx="24" cy="30" rx="8" ry="6" fill="%23f5e6d0"/><circle cx="18" cy="24" r="1.9" fill="%234a3526"/><circle cx="30" cy="24" r="1.9" fill="%234a3526"/><ellipse cx="24" cy="28" rx="2.1" ry="1.4" fill="%236b4a34"/><path d="M24 29.4 V31.4 M24 31.4 q-2.6 1.8 -4.4 .2 M24 31.4 q2.6 1.8 4.4 .2" fill="none" stroke="%236b4a34" stroke-width="1.2" stroke-linecap="round"/><circle cx="14.5" cy="29" r="2.4" fill="%23f4a6b6" opacity=".65"/><circle cx="33.5" cy="29" r="2.4" fill="%23f4a6b6" opacity=".65"/></svg>')!important;
      }

      /* ===== 🖥️ CODEPAD — 슬레이트 블루 + 도킹 보존 라존데 정적 에디터 테마 ===== */
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"]{--codepad-bg:#1f232b;--codepad-surface:#2a313b;--codepad-surface-2:#242a33;--codepad-edge:#aab7c4;--codepad-soft:#e9eef3;--codepad-head:#d8e0e8;--codepad-ink:#e8eef5;--codepad-mute:#b6c3cf;--codepad-accent:#e0b86c;--codepad-accent-2:#9bb7d4;--codepad-accent-3:#8fb8a3}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"][data-sgb-theme-colors="on"]{
        --sgb-readable-text:#eee9e0!important;--sgb-muted-text:#b5afa2!important;--sgb-strong-text:#f9f5ee!important;--sgb-italic-text:#b5afa2!important;--sgb-strong-highlight-text:#f9f5ee!important;
        --sgb-dialogue-rgb:208,166,140!important;--sgb-dialogue-text:#e6b79c!important;
        --sgb-thought-rgb:190,196,150!important;--sgb-thought-text:#cbd0a2!important;
        --sgb-italic-rgb:190,196,150!important;--sgb-strongbg-rgb:208,166,140!important;--sgb-code-rgb:150,146,132!important}

      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] [data-sgb-bubble="chat"]{
        position:relative!important;overflow:hidden!important;margin-top:8px!important;padding:38px 17px 17px!important;border-radius:14px!important;color:var(--sgb-readable-text)!important;
        background:linear-gradient(180deg,color-mix(in srgb, rgb(var(--sgb-dialogue-rgb,208,166,140)) 12%, rgba(94,90,82,calc(var(--sgb-theme-surface-alpha,.86)*.94))),color-mix(in srgb, rgb(var(--sgb-thought-rgb,190,196,150)) 10%, rgba(78,74,68,calc(var(--sgb-theme-surface-alpha,.86)*.94))))!important;
        border:1px solid rgba(255,255,255,.14)!important;box-shadow:0 16px 32px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,255,255,.1)!important;
        backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.28)) saturate(1.02)!important;-webkit-backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.28)) saturate(1.02)!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] [data-sgb-bubble="chat"]::before{
        content:""!important;position:absolute!important;left:0!important;right:0!important;top:0!important;height:28px!important;
        background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(236,239,243,.9))!important;
        border-bottom:1px solid rgba(0,0,0,.1)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.9)!important;pointer-events:none!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] [data-sgb-bubble="chat"]::after{
        content:""!important;position:absolute!important;left:16px!important;top:9px!important;width:10px!important;height:10px!important;border-radius:999px!important;
        background:#ff5f57!important;box-shadow:17px 0 0 #febc2e,34px 0 0 #28c840!important;opacity:1!important;pointer-events:none!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] [data-sgb-bubble="chat"] .wrtn-markdown{filter:none!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] [data-sgb-bubble="chat"] .wrtn-markdown :is(p,li,blockquote,h1,h2,h3,h4,h5,h6){padding-left:revert!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] [data-sgb-bubble="chat"] .wrtn-markdown :is(p,li,blockquote,h1,h2,h3,h4,h5,h6)::before{content:none!important}

      /* 대사/속마음 하이라이트: 스톤용 은은하게 */
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"][data-sgb-highlight-shape="highlight"][data-sgb-dialogue-bg="on"] main [data-sgb-message-group] [data-sgb-quote="double"]{
        background:linear-gradient(180deg,transparent 52%,rgba(var(--sgb-dialogue-rgb),.16) 52%)!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"][data-sgb-highlight-shape="highlight"][data-sgb-thought-bg="on"] main [data-sgb-message-group] [data-sgb-quote="single"]{
        background:linear-gradient(180deg,transparent 54%,rgba(var(--sgb-thought-rgb),.13) 54%)!important}

      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] [data-sgb-suggestion-button]{
        position:relative!important;overflow:hidden!important;border-radius:12px!important;color:var(--sgb-readable-text)!important;
        background:linear-gradient(180deg,color-mix(in srgb, rgb(var(--sgb-dialogue-rgb,208,166,140)) 10%, rgba(98,94,86,var(--sgb-theme-surface-alpha,.86))),color-mix(in srgb, rgb(var(--sgb-thought-rgb,190,196,150)) 8%, rgba(82,78,71,var(--sgb-theme-surface-alpha,.86))))!important;
        border:1px solid rgba(255,255,255,.12)!important;box-shadow:0 8px 18px rgba(0,0,0,.2),inset 0 1px 0 rgba(255,255,255,.08)!important;
        backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.2)) saturate(1.01)!important;-webkit-backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.2)) saturate(1.01)!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] [data-sgb-suggestion-button]::before{content:none!important}

      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] [data-sgb-input-box]{
        position:relative!important;overflow:hidden!important;border-radius:13px!important;color:var(--sgb-readable-text)!important;
        background:linear-gradient(180deg,color-mix(in srgb, rgb(var(--sgb-dialogue-rgb,208,166,140)) 10%, rgba(72,69,63,calc(var(--sgb-theme-surface-alpha,.86)*.96))),color-mix(in srgb, rgb(var(--sgb-thought-rgb,190,196,150)) 8%, rgba(58,55,50,calc(var(--sgb-theme-surface-alpha,.86)*.96))))!important;
        border:1px solid rgba(255,255,255,.12)!important;box-shadow:0 10px 24px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.08)!important;
        backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.2)) saturate(1.01)!important;-webkit-backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.2)) saturate(1.01)!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] [data-sgb-input-box]::before{content:none!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] [data-sgb-input-box] .is-editor-empty:first-child:before{color:rgba(238,233,224,.5)!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] [data-sgb-input-box] .send{background:linear-gradient(120deg,rgb(var(--sgb-dialogue-rgb,216,166,126)),rgb(var(--sgb-thought-rgb,200,206,158)))!important;color:#2e2820!important}

      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] main [data-sgb-codeblock]{
        overflow:hidden!important;border-radius:12px!important;border:1px solid rgba(233,238,243,.14)!important;background:rgba(20,23,29,.72)!important;box-shadow:0 8px 18px rgba(0,0,0,.22)!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] main [data-sgb-codeblock-head]{
        background:rgba(31,35,43,.92)!important;color:#dce6ef!important;border-bottom:1px solid rgba(233,238,243,.12)!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] main [data-sgb-codeblock-body]{
        background:rgba(20,23,29,.86)!important;color:#f0f5f9!important;text-shadow:none!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] main [data-sgb-codeblock-body] *{
        color:#f0f5f9!important;text-shadow:none!important}

      /* 코드블록 글씨 최종 보정: 테마별 코드블록 스킨 뒤에서도 크기/행간/자간 유지 */
      html.${CLS_ACTIVE} main [data-sgb-codeblock] [data-sgb-codeblock-body],
      html.${CLS_ACTIVE} main [data-sgb-codeblock] [data-sgb-codeblock-body] :is(pre, code, span, div) {
        font-family: var(--sgb-custom-chat-font-stack, inherit) !important;
        font-size: var(--sgb-codeblock-font-size, calc(13px * var(--sgb-code-text-scale, 1))) !important;
        line-height: 1.45 !important;
        letter-spacing: 0 !important;
        font-weight: 400 !important;
      }

      /* 라존데: 다른 테마처럼 본체 박스 스타일은 펼친 상태에만 적용한다. inline 도킹 상태는 위치/크기 건드리지 않음. */
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline){
        overflow:hidden!important;border-radius:14px!important;background:linear-gradient(180deg,rgba(36,42,51,.98),rgba(27,31,39,.98))!important;color:#e8eef5!important;
        border:1px solid rgba(233,238,243,.18)!important;box-shadow:0 10px 24px rgba(0,0,0,.26),inset 0 1px 0 rgba(255,255,255,.08)!important;
        backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.08)) saturate(1.01)!important;-webkit-backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.08)) saturate(1.01)!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline)::before{content:none!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] #igx-live-popup[data-sgb-radiosonde-skin] #igx-live-head,
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] #igx-live-popup[data-sgb-radiosonde-skin] .igx-btn{
        background:rgba(233,238,243,.12)!important;color:#f4f8fb!important;border-color:rgba(170,183,196,.42)!important;box-shadow:0 1px 2px rgba(0,0,0,.16)!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline) #igx-live-head{
        border-radius:10px!important;border:1px solid rgba(233,238,243,.16)!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] #igx-live-popup[data-sgb-radiosonde-skin] .igx-btn{
        border-radius:999px!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] #igx-live-popup[data-sgb-radiosonde-skin] .igx-btn:hover{
        background:rgba(233,238,243,.20)!important;border-color:rgba(224,184,108,.72)!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline),
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline) *{
        color:#e8eef5!important;opacity:1!important;text-shadow:none!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline) .bitem{
        background:rgba(255,255,255,.04)!important;border-color:rgba(233,238,243,.10)!important;color:#e8eef5!important}

      /* ===== 🐚 NAJEON — 칠흑 옻칠 위로 자개 무지갯빛이 좌우로 천천히 흐름 ===== */
      @keyframes sgbNacre{0%{background-position:0% 50%,18% 28%,80% 68%}100%{background-position:100% 50%,18% 28%,80% 68%}}
      html.${CLS_ACTIVE}[data-sgb-ui-style="najeon"][data-sgb-theme-colors="on"]{
        --sgb-readable-text:#efeaf3!important;--sgb-muted-text:#c2bbd4!important;--sgb-strong-text:#ffffff!important;--sgb-italic-text:#c2bbd4!important;--sgb-strong-highlight-text:#ffffff!important;
        --sgb-dialogue-rgb:150,205,235!important;--sgb-dialogue-text:#eef7ff!important;--sgb-thought-rgb:200,170,235!important;--sgb-thought-text:#f4eeff!important;
        --sgb-italic-rgb:175,140,225!important;--sgb-strongbg-rgb:140,205,235!important;--sgb-code-rgb:130,175,228!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="najeon"] [data-sgb-bubble="chat"]{
        border-radius:12px!important;color:var(--sgb-readable-text)!important;background-color:rgba(16,15,21,var(--sgb-theme-surface-alpha,.86))!important;
        background-image:linear-gradient(115deg,rgba(120,200,255,.16),rgba(180,140,255,.14) 28%,rgba(120,255,210,.14) 52%,rgba(255,180,220,.15) 74%,rgba(120,200,255,.16)),radial-gradient(36% 60% at 18% 28%,rgba(150,255,220,.22),transparent 62%),radial-gradient(40% 64% at 80% 68%,rgba(200,160,255,.2),transparent 62%)!important;
        background-repeat:no-repeat!important;background-size:300% 100%,auto,auto!important;background-position:0% 50%,18% 28%,80% 68%!important;
        border:1px solid rgba(200,210,255,.20)!important;box-shadow:0 14px 34px rgba(0,0,0,.42),inset 0 1px 0 rgba(220,225,255,.16),inset 0 0 22px rgba(120,160,255,.06)!important;
        backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.38)) saturate(1.10)!important;-webkit-backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.38)) saturate(1.10)!important;
        animation:sgbNacre 16s linear infinite!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="najeon"] [data-sgb-suggestion-button]{border-radius:11px!important;background-color:rgba(19,18,26,var(--sgb-theme-surface-alpha,.86))!important;background-image:linear-gradient(115deg,rgba(120,200,255,.12),rgba(255,180,220,.1) 60%,rgba(120,255,210,.1))!important;color:var(--sgb-readable-text)!important;border:1px solid rgba(200,210,255,.18)!important;backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.30)) saturate(1.08)!important;-webkit-backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.30)) saturate(1.08)!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="najeon"] [data-sgb-input-box]{border-radius:11px!important;background-color:rgba(42,39,58,calc(var(--sgb-theme-surface-alpha,.86)*.74))!important;background-image:linear-gradient(115deg,rgba(130,205,255,.12),rgba(210,170,255,.10) 56%,rgba(150,255,220,.08))!important;color:var(--sgb-readable-text)!important;border:1px solid rgba(220,226,255,.24)!important;box-shadow:inset 0 1px 0 rgba(245,245,255,.14),0 8px 20px rgba(0,0,0,.18)!important;backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.32)) saturate(1.10)!important;-webkit-backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.32)) saturate(1.10)!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="najeon"] [data-sgb-input-box] .is-editor-empty:first-child:before{color:rgba(238,242,255,.58)!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="najeon"] [data-sgb-input-box] .send{background:linear-gradient(120deg,#86c8ff,#c9a6ff)!important;color:#0e0d15!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="najeon"] #igx-live-popup[data-sgb-radiosonde-skin]:not(.inline){background:rgba(19,18,26,var(--sgb-theme-surface-alpha,.86))!important;border:1px solid rgba(200,210,255,.20)!important;box-shadow:0 8px 22px rgba(0,0,0,.34),inset 0 1px 0 rgba(220,225,255,.10)!important;backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.30)) saturate(1.08)!important;-webkit-backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.30)) saturate(1.08)!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="najeon"] #igx-live-popup[data-sgb-radiosonde-skin] #igx-live-head,
      html.${CLS_ACTIVE}[data-sgb-ui-style="najeon"] #igx-live-popup[data-sgb-radiosonde-skin] .igx-btn{background:rgba(150,180,255,.16)!important;color:var(--sgb-readable-text)!important;border-color:rgba(200,210,255,.20)!important;backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.18)) saturate(1.04)!important;-webkit-backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.18)) saturate(1.04)!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="najeon"] #igx-live-popup[data-sgb-radiosonde-skin] .bitem{color:var(--sgb-readable-text)!important}


      /* ===== Cozy: 종이 표면(챗/추천답변/입력창) 글자 변수 정리 ===== */

      /* v1.1.2 — 실제 메시지 수정창 DOM 전용 가독성 보정.
         수정 모드는 .wrtn-markdown이 아니라 contenteditable .tiptap.ProseMirror 구조라서
         수정 말풍선/수정 박스에 별도 마커를 붙이고, 그 안쪽 글자색을 표면용 변수로 맞춘다. */
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] main [data-sgb-edit-bubble]{
        color:var(--cozy-ink)!important;
        background:
          linear-gradient(180deg, rgba(255,255,255,calc(var(--cozy-alpha) * .30)), rgba(255,255,255,0) 16%),
          radial-gradient(120% 80% at 8% 0%, rgba(246,228,197,calc(var(--cozy-alpha) * .34)), transparent 36%),
          repeating-linear-gradient(0deg, rgba(104,82,56,.020) 0 1.2px, rgba(255,255,255,0) 1.2px 7px),
          repeating-linear-gradient(90deg, rgba(104,82,56,.016) 0 1.2px, rgba(255,255,255,0) 1.2px 9px),
          repeating-linear-gradient(0deg, rgba(191,165,129,.075) 0 1.4px, rgba(255,255,255,0) 1.4px 32px),
          repeating-linear-gradient(90deg, rgba(191,165,129,.060) 0 1.4px, rgba(255,255,255,0) 1.4px 32px),
          linear-gradient(180deg,rgba(234,220,199,calc(var(--cozy-alpha) * .98)),rgba(221,204,179,calc(var(--cozy-alpha) * .98)))!important;
        border:1px solid rgba(191,165,129,calc(var(--cozy-alpha) * .78))!important;
        border-left:3px solid rgba(216,173,88,.86)!important;
        box-shadow:0 3px 10px rgba(76,56,34,.18),inset 0 1px 0 rgba(255,255,255,.72),inset 0 -1px 0 rgba(174,145,108,.28)!important;
        text-shadow:none!important;
      }
      html.${CLS_ACTIVE} main [data-sgb-edit-bubble] [data-sgb-edit-box]{
        color:var(--sgb-readable-text)!important;
        background:rgba(255,255,255,.18)!important;
        border:1px solid rgba(40,34,28,.18)!important;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.20)!important;
      }
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] main [data-sgb-edit-bubble] [data-sgb-edit-box]{
        color:var(--cozy-ink)!important;
        background:rgba(255,255,255,.22)!important;
        border:1px solid rgba(191,165,129,.42)!important;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.24)!important;
      }
      html.${CLS_ACTIVE} main [data-sgb-edit-bubble] :is(.tiptap.ProseMirror[contenteditable="true"], .ProseMirror[contenteditable="true"], [contenteditable="true"][translate="no"], [role="textbox"], textarea),
      html.${CLS_ACTIVE} main [data-sgb-edit-bubble] :is(.tiptap.ProseMirror[contenteditable="true"], .ProseMirror[contenteditable="true"], [contenteditable="true"][translate="no"], [role="textbox"], textarea) * {
        color:var(--sgb-readable-text)!important;
        -webkit-text-fill-color:var(--sgb-readable-text)!important;
        caret-color:var(--sgb-readable-text)!important;
        text-shadow:none!important;
      }
      html.${CLS_ACTIVE} main [data-sgb-edit-bubble] :is(.tiptap.ProseMirror[contenteditable="true"], .ProseMirror[contenteditable="true"], [contenteditable="true"][translate="no"], [role="textbox"], textarea)::placeholder,
      html.${CLS_ACTIVE} main [data-sgb-edit-bubble] .is-editor-empty:first-child:before{
        color:var(--sgb-muted-text)!important;
        -webkit-text-fill-color:var(--sgb-muted-text)!important;
      }

      /* ===== 코드블록 바디: 테마톤 어둠 (글자 가독성 유지) ===== */
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"][data-sgb-code-bg="on"] main [data-sgb-codeblock-body]{background:rgba(42,32,22,.60)!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"][data-sgb-code-bg="on"] main [data-sgb-codeblock-body]{background:rgba(23,18,25,.70)!important}
      html.${CLS_ACTIVE}[data-sgb-ui-style="najeon"][data-sgb-code-bg="on"] main [data-sgb-codeblock-body]{background:rgba(14,12,20,.58)!important}


      /* ===== 📰 NEWSPRINT — 신문 활자 (겹테두리 액자형) ===== */
      html.sgb-bg-active[data-sgb-ui-style="newsprint"][data-sgb-theme-colors="on"]{
        --sgb-readable-text:#221f19!important;--sgb-muted-text:#5a544a!important;--sgb-strong-text:#000000!important;
        --sgb-italic-text:#5a544a!important;--sgb-strong-highlight-text:#000000!important;
        --sgb-dialogue-rgb:74,68,56!important;--sgb-dialogue-text:#221f19!important;--sgb-thought-rgb:150,144,130!important;--sgb-thought-text:#4a4438!important;
        --sgb-italic-rgb:205,197,179!important;--sgb-strongbg-rgb:150,140,120!important;--sgb-code-rgb:150,140,120!important}

      /* 종이 위 어두운 글자 */
      html.sgb-bg-active[data-sgb-ui-style="newsprint"][data-sgb-theme-colors="on"] [data-sgb-bubble="chat"],
      html.sgb-bg-active[data-sgb-ui-style="newsprint"][data-sgb-theme-colors="on"] [data-sgb-suggestion-button],
      html.sgb-bg-active[data-sgb-ui-style="newsprint"][data-sgb-theme-colors="on"] [data-sgb-input-box]{
        --sgb-readable-text:#221f19!important;--sgb-muted-text:#5a544a!important;--sgb-strong-text:#000000!important;
        --sgb-italic-text:#5a544a!important;--sgb-strong-highlight-text:#000000!important;
        --sgb-dialogue-text:#221f19!important;--sgb-thought-text:#4a4438!important}

      /* 신문 활자 정렬: 폰트 강제 없이 양쪽정렬만 유지 */
      html.sgb-bg-active[data-sgb-ui-style="newsprint"] main [data-sgb-message-group] .wrtn-markdown,
      html.sgb-bg-active[data-sgb-ui-style="newsprint"] main [data-sgb-message-group] .wrtn-markdown :is(p,li,blockquote,span,em,strong,a){
        text-align:justify!important}

      /* 신문지 말풍선 + 얇은 겹테두리 (UI 불투명도 연동) */
      html.sgb-bg-active[data-sgb-ui-style="newsprint"] [data-sgb-bubble="chat"]{
        position:relative!important;border-radius:2px!important;color:var(--sgb-readable-text)!important;padding:20px 22px!important;
        background-color:rgba(243,236,218,var(--sgb-theme-surface-alpha,.86))!important;
        background-image:radial-gradient(rgba(60,55,45,.06) 1px, transparent 1.2px)!important;background-size:4px 4px!important;
        border:2px double #2a2620!important;
        box-shadow:inset 0 0 0 1px #2a2620,0 12px 26px rgba(0,0,0,.4)!important;
        backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
      html.sgb-bg-active[data-sgb-ui-style="newsprint"][data-sgb-theme-colors="on"] [data-sgb-bubble="chat"] .wrtn-markdown{filter:none!important}

      /* 상단 ✦✦✦ 구분선 / 하단 —◆— (반복돼도 자연스러운 장식) */
      html.sgb-bg-active[data-sgb-ui-style="newsprint"] [data-sgb-bubble="chat"] .wrtn-markdown::before{
        content:"✦   ✦   ✦"!important;display:block!important;text-align:center!important;
        font-size:11px!important;letter-spacing:4px!important;color:#2a2620!important;
        border-bottom:1px solid #2a2620!important;padding-bottom:9px!important;margin-bottom:12px!important}
      html.sgb-bg-active[data-sgb-ui-style="newsprint"] [data-sgb-bubble="chat"] .wrtn-markdown::after{
        content:none!important;display:none!important}

      /* Newsprint 대사/생각 강조는 공통 마크다운 강조 규칙을 따른다. */

      /* 추천답변 / 입력창 = 종이쪽지 (얇은 겹테두리) */
      html.sgb-bg-active[data-sgb-ui-style="newsprint"] [data-sgb-suggestion-button]{
        border-radius:2px!important;color:var(--sgb-readable-text)!important;
        background:rgba(243,236,218,var(--sgb-theme-surface-alpha,.86))!important;border:2px double #2a2620!important;box-shadow:inset 0 0 0 1px #2a2620!important}
      html.sgb-bg-active[data-sgb-ui-style="newsprint"] [data-sgb-suggestion-button] .wrtn-markdown em{color:var(--sgb-muted-text)!important}
      html.sgb-bg-active[data-sgb-ui-style="newsprint"] [data-sgb-input-box]{
        border-radius:2px!important;color:var(--sgb-readable-text)!important;
        background:rgba(243,236,218,var(--sgb-theme-surface-alpha,.86))!important;border:1px solid rgba(207,199,179,.9)!important;box-shadow:none!important}
      html.sgb-bg-active[data-sgb-ui-style="newsprint"] [data-sgb-input-box] .is-editor-empty:first-child:before{color:rgba(90,84,72,.6)!important}

      /* 수정창 가독성 */
      html.sgb-bg-active[data-sgb-ui-style="newsprint"][data-sgb-theme-colors="on"] main [data-sgb-edit-bubble]{
        --sgb-readable-text:#221f19!important;--sgb-muted-text:#5a544a!important;--sgb-strong-text:#000000!important;--sgb-italic-text:#5a544a!important;--sgb-strong-highlight-text:#000000!important}
      html.sgb-bg-active[data-sgb-ui-style="newsprint"] main [data-sgb-edit-bubble]{
        color:var(--sgb-readable-text)!important;background:rgba(243,236,218,var(--sgb-theme-surface-alpha,.86))!important;border:2px double #2a2620!important;box-shadow:inset 0 0 0 1px #2a2620!important;text-shadow:none!important}

      /* 코드블록 바디 톤 */
      html.sgb-bg-active[data-sgb-ui-style="newsprint"][data-sgb-code-bg="on"] main [data-sgb-codeblock-body]{background:rgba(38,34,26,.6)!important}

      /* Cozy 발바닥 불릿 안정화: 실제 '-' 자리처럼 보이되 글자 흐름은 건드리지 않게 */
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="cozy"] main [data-sgb-message-group] .wrtn-markdown ul{
        padding-left:1.28em!important;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="cozy"] main [data-sgb-message-group] .wrtn-markdown ul>li{
        position:relative!important;
        list-style:none!important;
        padding-left:18px!important;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="cozy"] main [data-sgb-message-group] .wrtn-markdown ul>li::marker{
        content:""!important;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="cozy"] main [data-sgb-message-group] .wrtn-markdown ul>li::before{
        content:""!important;
        position:absolute!important;
        left:0!important;
        top:.36em!important;
        display:block!important;
        width:12px!important;
        height:12px!important;
        margin:0!important;
        background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><ellipse cx='12' cy='16' rx='6' ry='5' fill='%238a6234'/><circle cx='5' cy='9' r='2.4' fill='%238a6234'/><circle cx='12' cy='6.5' r='2.6' fill='%238a6234'/><circle cx='19' cy='9' r='2.4' fill='%238a6234'/></svg>")!important;
        background-size:contain!important;
        background-repeat:no-repeat!important;
        background-position:center!important;
      }
      html.${CLS_ACTIVE}[data-sgb-markdown-decor="on"][data-sgb-ui-style="cozy"] main [data-sgb-message-group] .wrtn-markdown ul>li:has(input[type="checkbox"]){
        padding-left:18px!important;
      }


      /* ===== 🎷 JAZZBAR — 벨벳 재즈바 (딥레드+금 이중테두리) ===== */
      html.sgb-bg-active[data-sgb-ui-style="jazzbar"][data-sgb-theme-colors="on"]{
        --sgb-readable-text:#f0dcc8!important;--sgb-muted-text:#c8966a!important;--sgb-strong-text:#e8c888!important;--sgb-italic-text:#c8966a!important;--sgb-strong-highlight-text:#e8c888!important;
        --sgb-dialogue-rgb:200,150,90!important;--sgb-dialogue-text:#f0d8b0!important;--sgb-thought-rgb:150,110,80!important;--sgb-thought-text:#e0c0a0!important;
        --sgb-italic-rgb:200,150,106!important;--sgb-strongbg-rgb:232,200,136!important;--sgb-code-rgb:200,164,90!important}

      /* Jazzbar: 폰트 강제 없음 */

      /* 말풍선: 딥레드 벨벳 + 금 이중테두리 */
      html.sgb-bg-active[data-sgb-ui-style="jazzbar"] [data-sgb-bubble="chat"]{
        position:relative!important;border-radius:4px!important;color:var(--sgb-readable-text)!important;
        background:linear-gradient(180deg, rgba(58,20,32,var(--sgb-theme-surface-alpha,.86)), rgba(40,12,22,var(--sgb-theme-surface-alpha,.86)))!important;
        border:1px solid #8a4a58!important;
        box-shadow:0 0 0 3px rgba(200,164,90,.18),0 14px 32px rgba(0,0,0,.55)!important;
        backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.3)) saturate(1.04)!important;-webkit-backdrop-filter:blur(calc(var(--sgb-glass-blur,12px)*.3)) saturate(1.04)!important}
      html.sgb-bg-active[data-sgb-ui-style="jazzbar"] [data-sgb-bubble="chat"]::before{
        content:""!important;position:absolute!important;inset:4px!important;border:1px solid rgba(212,168,100,.4)!important;border-radius:2px!important;pointer-events:none!important;z-index:1!important}
      html.sgb-bg-active[data-sgb-ui-style="jazzbar"][data-sgb-theme-colors="on"] [data-sgb-bubble="chat"] .wrtn-markdown{filter:none!important}

      /* Jazzbar 대사/생각 강조는 공통 강조 배경 규칙을 따른다. */

      /* 추천답변 / 입력창 = 같은 금 프레임 */
      html.sgb-bg-active[data-sgb-ui-style="jazzbar"] [data-sgb-suggestion-button]{
        border-radius:4px!important;color:var(--sgb-readable-text)!important;
        background:rgba(40,12,22,var(--sgb-theme-surface-alpha,.86))!important;border:1px solid #8a4a58!important;
        box-shadow:0 0 0 3px rgba(200,164,90,.15),0 8px 18px rgba(0,0,0,.4)!important}
      html.sgb-bg-active[data-sgb-ui-style="jazzbar"] [data-sgb-suggestion-button] .wrtn-markdown em{color:var(--sgb-muted-text)!important}
      html.sgb-bg-active[data-sgb-ui-style="jazzbar"] [data-sgb-input-box]{
        border-radius:4px!important;color:var(--sgb-readable-text)!important;
        background:rgba(40,12,22,var(--sgb-theme-surface-alpha,.86))!important;border:1px solid #8a4a58!important;
        box-shadow:0 0 0 3px rgba(200,164,90,.15)!important}
      html.sgb-bg-active[data-sgb-ui-style="jazzbar"] [data-sgb-input-box] .is-editor-empty:first-child:before{color:rgba(200,150,106,.6)!important}

      /* 수정창 가독성 */
      html.sgb-bg-active[data-sgb-ui-style="jazzbar"][data-sgb-theme-colors="on"] main [data-sgb-edit-bubble]{
        --sgb-readable-text:#f0dcc8!important;--sgb-muted-text:#c8966a!important;--sgb-strong-text:#e8c888!important;--sgb-italic-text:#c8966a!important;--sgb-strong-highlight-text:#e8c888!important}
      html.sgb-bg-active[data-sgb-ui-style="jazzbar"] main [data-sgb-edit-bubble]{
        color:var(--sgb-readable-text)!important;
        background:linear-gradient(180deg, rgba(58,20,32,.9), rgba(40,12,22,.9))!important;
        border:1px solid #8a4a58!important;box-shadow:0 0 0 3px rgba(200,164,90,.15)!important;text-shadow:none!important}

      /* 코드블록 바디 톤 */
      html.sgb-bg-active[data-sgb-ui-style="jazzbar"][data-sgb-code-bg="on"] main [data-sgb-codeblock-body]{background:rgba(30,10,16,.62)!important}

      /* Jazzbar: 변형 선택 시 벨벳 바탕 + 금 프레임을 팔레트색으로 (기준=딥레드 유지) */
      html.sgb-bg-active[data-sgb-ui-style="jazzbar"][data-sgb-theme-colors="off"] [data-sgb-bubble="chat"],
      html.sgb-bg-active[data-sgb-ui-style="jazzbar"][data-sgb-theme-colors="off"] [data-sgb-suggestion-button],
      html.sgb-bg-active[data-sgb-ui-style="jazzbar"][data-sgb-theme-colors="off"] [data-sgb-input-box],
      html.sgb-bg-active[data-sgb-ui-style="jazzbar"][data-sgb-theme-colors="off"] main [data-sgb-edit-bubble]{
        background:linear-gradient(180deg,
            rgba(var(--sgb-dialogue-rgb,200,164,90),.26),
            rgba(var(--sgb-dialogue-rgb,200,164,90),.12)),
            rgba(18,12,16,var(--sgb-theme-surface-alpha,.86))!important;
        border-color:rgba(var(--sgb-dialogue-rgb,200,164,90),.50)!important;
        box-shadow:0 0 0 3px rgba(var(--sgb-dialogue-rgb,200,164,90),.20), 0 14px 32px rgba(0,0,0,.5)!important;
      }
      /* Jazzbar: 안쪽 금 프레임(::before)도 팔레트색으로 */
      html.sgb-bg-active[data-sgb-ui-style="jazzbar"][data-sgb-theme-colors="off"] [data-sgb-bubble="chat"]::before{
        border-color:rgba(var(--sgb-dialogue-rgb,200,164,90),.42)!important;
      }


      /* ===== Novel UI clean separator mode =====
         소설형 UI는 배경/패턴/카드/테두리를 만들지 않는다.
         v1.8.6: 소설형 구분선은 메시지 사이에만 두고, markdown <hr>는 기존 마크다운 렌더러 스타일을 따른다. 장식 구분선 하단 여백 +1px.
         - normal/borderless: 기존처럼 얇은 선만 유지
         - 그 외 테마: gradient 선을 깔지 않고 특수문자 장식 자체를 구분선으로 사용 */
      html.${CLS_ACTIVE} {
        --sgb-novel-sep-box-height: 1px;
        --sgb-novel-sep-bg: linear-gradient(90deg, transparent, rgba(var(--sgb-dialogue-rgb,185,165,180),.36), rgba(var(--sgb-thought-rgb,172,162,182),.24), rgba(var(--sgb-dialogue-rgb,185,165,180),.36), transparent);
        --sgb-novel-sep-border-top: 0;
        --sgb-novel-sep-border-bottom: 0;
        --sgb-novel-sep-shadow: none;
        --sgb-novel-sep-margin: 8px clamp(12px, 2.4vw, 28px);
        --sgb-novel-hr-margin: .85em 0;
        --sgb-novel-sep-content: "";
        --sgb-novel-sep-color: rgba(var(--sgb-dialogue-rgb,185,165,180),.68);
        --sgb-novel-sep-font-size: 12px;
        --sgb-novel-sep-letter-spacing: .16em;
        --sgb-novel-sep-text-shadow: none;
        --sgb-novel-sep-font-family: ui-serif, Georgia, 'Times New Roman', serif;
        --sgb-novel-sep-font-weight: 600;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="normal"],
      html.${CLS_ACTIVE}[data-sgb-ui-style="borderless"] {
        --sgb-novel-sep-box-height: 1px;
        --sgb-novel-sep-bg: linear-gradient(90deg, transparent, rgba(255,255,255,.08), rgba(var(--sgb-dialogue-rgb,185,165,180),.18), rgba(255,255,255,.08), transparent);
        --sgb-novel-sep-content: "";
        --sgb-novel-sep-shadow: none;
      }

      html.${CLS_ACTIVE}:not([data-sgb-ui-style="normal"]):not([data-sgb-ui-style="borderless"]) {
        --sgb-novel-sep-margin: 7px clamp(12px, 2.4vw, 28px) 13px;
        --sgb-novel-hr-margin: .8em 0 1.05em;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="glass"] {
        --sgb-novel-sep-box-height: 12px;
        --sgb-novel-sep-bg: none;
        --sgb-novel-sep-content: "◇ ✧ ◇";
        --sgb-novel-sep-color: rgba(var(--sgb-dialogue-rgb,150,180,235),.82);
        --sgb-novel-sep-font-size: 9px;
        --sgb-novel-sep-letter-spacing: .22em;
        --sgb-novel-sep-text-shadow: 0 0 4px rgba(var(--sgb-dialogue-rgb,150,180,235),.34), 0 0 6px rgba(var(--sgb-thought-rgb,150,165,205),.14);
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="pixel"] {
        --sgb-novel-sep-box-height: 16px;
        --sgb-novel-sep-bg: none;
        --sgb-novel-sep-content: "▪ ▫ ▪ ▫ ▪";
        --sgb-novel-sep-color: rgba(var(--sgb-dialogue-rgb,120,215,225),.78);
        --sgb-novel-sep-font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        --sgb-novel-sep-font-size: 11px;
        --sgb-novel-sep-letter-spacing: .24em;
        --sgb-novel-sep-text-shadow: 0 0 4px rgba(var(--sgb-dialogue-rgb,120,215,225),.22);
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="sticker"] {
        --sgb-novel-sep-box-height: 12px;
        --sgb-novel-sep-bg: none;
        --sgb-novel-sep-content: "✧ ♡ ✧";
        --sgb-novel-sep-color: rgba(var(--sgb-dialogue-rgb,255,190,214),.88);
        --sgb-novel-sep-font-size: 9.5px;
        --sgb-novel-sep-letter-spacing: .22em;
        --sgb-novel-sep-text-shadow: 0 1px 0 rgba(255,255,255,.12), 0 0 4px rgba(var(--sgb-dialogue-rgb,255,190,214),.30);
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="candy"] {
        --sgb-novel-sep-box-height: 12px;
        --sgb-novel-sep-bg: none;
        --sgb-novel-sep-content: "✧ ◆ ✧";
        --sgb-novel-sep-color: rgba(var(--sgb-dialogue-rgb,255,185,202),.90);
        --sgb-novel-sep-font-size: 9px;
        --sgb-novel-sep-letter-spacing: .22em;
        --sgb-novel-sep-text-shadow: 0 0 4px rgba(var(--sgb-dialogue-rgb,255,185,202),.30), 0 0 6px rgba(var(--sgb-thought-rgb,178,222,255),.18);
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] {
        --sgb-novel-sep-box-height: 12px;
        --sgb-novel-sep-bg: none;
        --sgb-novel-sep-content: "· ✦ ·";
        --sgb-novel-sep-color: rgba(var(--sgb-dialogue-rgb,224,196,142),.78);
        --sgb-novel-sep-font-size: 9.5px;
        --sgb-novel-sep-letter-spacing: .22em;
        --sgb-novel-sep-text-shadow: 0 1px 0 rgba(0,0,0,.22), 0 0 3px rgba(var(--sgb-dialogue-rgb,224,196,142),.18);
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] {
        --sgb-novel-sep-box-height: 12px;
        --sgb-novel-sep-bg: none;
        --sgb-novel-sep-content: "─ ◆ ─";
        --sgb-novel-sep-color: rgba(var(--sgb-dialogue-rgb,208,166,140),.70);
        --sgb-novel-sep-font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        --sgb-novel-sep-font-size: 9px;
        --sgb-novel-sep-letter-spacing: .18em;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="najeon"] {
        --sgb-novel-sep-box-height: 12px;
        --sgb-novel-sep-bg: none;
        --sgb-novel-sep-content: "◇ ✦ ◇";
        --sgb-novel-sep-color: rgba(var(--sgb-dialogue-rgb,150,205,235),.90);
        --sgb-novel-sep-font-size: 9px;
        --sgb-novel-sep-letter-spacing: .22em;
        --sgb-novel-sep-text-shadow: 0 0 4px rgba(var(--sgb-dialogue-rgb,120,210,255),.34), 0 0 6px rgba(var(--sgb-thought-rgb,210,160,255),.22);
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="starjar"] {
        --sgb-novel-sep-box-height: 12px;
        --sgb-novel-sep-bg: none;
        --sgb-novel-sep-content: "✦ ✧ ✦";
        --sgb-novel-sep-color: rgba(var(--sgb-dialogue-rgb,240,207,126),.94);
        --sgb-novel-sep-font-size: 9px;
        --sgb-novel-sep-letter-spacing: .22em;
        --sgb-novel-sep-text-shadow: 0 0 4px rgba(var(--sgb-dialogue-rgb,255,225,130),.42), 0 0 7px rgba(var(--sgb-thought-rgb,150,142,196),.16);
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="newsprint"] {
        --sgb-novel-sep-box-height: 12px;
        --sgb-novel-sep-bg: none;
        --sgb-novel-sep-content: "— ◆ —";
        --sgb-novel-sep-color: rgba(210,196,164,.76);
        --sgb-novel-sep-font-family: Georgia, 'Times New Roman', serif;
        --sgb-novel-sep-font-size: 9px;
        --sgb-novel-sep-letter-spacing: .16em;
        --sgb-novel-sep-text-shadow: 0 1px 0 rgba(0,0,0,.30), 0 0 3px rgba(210,196,164,.18);
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="jazzbar"] {
        --sgb-novel-sep-box-height: 12px;
        --sgb-novel-sep-bg: none;
        --sgb-novel-sep-content: "◆ ✦ ◆";
        --sgb-novel-sep-color: rgba(var(--sgb-dialogue-rgb,200,150,90),.88);
        --sgb-novel-sep-font-size: 9px;
        --sgb-novel-sep-letter-spacing: .22em;
        --sgb-novel-sep-text-shadow: 0 0 4px rgba(var(--sgb-dialogue-rgb,232,200,136),.26);
      }

      /* Novel-only readability tune: 배경판이 없는 소설형에서만 종이 계열 추천색/마크다운 색을 보정한다. */
      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"][data-sgb-theme-colors="on"] main [data-sgb-bubble="novel"] {
        --sgb-readable-text: #e8dcc8 !important;
        --sgb-muted-text: #cdb88f !important;
        --sgb-strong-text: #fff0d2 !important;
        --sgb-italic-text: #cdb88f !important;
        --sgb-strong-highlight-text: #fff0d2 !important;
        --sgb-dialogue-text: #f0cc8a !important;
        --sgb-thought-text: #d9c29a !important;
        --cozy-ink: #e8dcc8 !important;
        --cozy-muted: #cdb88f !important;
        --cozy-strong: #fff0d2 !important;
        --cozy-dialogue-text: #f0cc8a !important;
        --cozy-thought-text: #d9c29a !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="newsprint"][data-sgb-theme-colors="on"] main [data-sgb-bubble="novel"] {
        --sgb-readable-text: #d8cdb8 !important;
        --sgb-muted-text: #a99a82 !important;
        --sgb-strong-text: #f0e1c6 !important;
        --sgb-italic-text: #b9aa91 !important;
        --sgb-strong-highlight-text: #f0e1c6 !important;
        --sgb-dialogue-text: #dbc6a3 !important;
        --sgb-thought-text: #b8aa91 !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"][data-sgb-theme-colors="on"] main [data-sgb-bubble="novel"] .wrtn-markdown {
        color: var(--sgb-readable-text) !important;
        --sgb-md-accent: rgba(240,204,138,.72);
        --sgb-md-accent-soft: rgba(240,204,138,.13);
        --sgb-md-line: rgba(240,204,138,.26);
        --sgb-md-quote-line: rgba(240,204,138,.42);
        --sgb-md-code-bg: rgba(240,204,138,.16);
        --sgb-md-code-text: #ffe2a8;
        --sgb-md-heading-symbol-color: rgba(240,204,138,.72);
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="newsprint"][data-sgb-theme-colors="on"] main [data-sgb-bubble="novel"] .wrtn-markdown {
        color: var(--sgb-readable-text) !important;
        --sgb-md-accent: rgba(218,196,158,.74);
        --sgb-md-accent-soft: rgba(218,196,158,.14);
        --sgb-md-line: rgba(218,196,158,.25);
        --sgb-md-quote-line: rgba(218,196,158,.44);
        --sgb-md-code-bg: rgba(218,196,158,.15);
        --sgb-md-code-text: #f1dcbb;
        --sgb-md-heading-symbol-color: rgba(218,196,158,.74);
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"][data-sgb-theme-colors="on"] main [data-sgb-bubble="novel"] .wrtn-markdown :is(p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th) code,
      html.${CLS_ACTIVE}[data-sgb-ui-style="newsprint"][data-sgb-theme-colors="on"] main [data-sgb-bubble="novel"] .wrtn-markdown :is(p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th) code {
        color: var(--sgb-md-code-text) !important;
        -webkit-text-fill-color: var(--sgb-md-code-text) !important;
        background: var(--sgb-md-code-bg) !important;
        border-color: var(--sgb-md-line) !important;
        text-shadow: none !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="newsprint"][data-sgb-theme-colors="on"] main [data-sgb-bubble="novel"] .wrtn-markdown a {
        color: #f0d2a0 !important;
        border-bottom-color: rgba(240,210,160,.58) !important;
        text-decoration-color: rgba(240,210,160,.58) !important;
        text-underline-offset: .16em !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="newsprint"][data-sgb-theme-colors="on"] main [data-sgb-bubble="novel"] .wrtn-markdown a:hover {
        color: #ffe4b4 !important;
        border-bottom-color: rgba(255,228,180,.72) !important;
        text-decoration-color: rgba(255,228,180,.72) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="newsprint"][data-sgb-theme-colors="on"] main [data-sgb-bubble="novel"] .wrtn-markdown blockquote {
        color: var(--sgb-readable-text) !important;
        border-left-color: var(--sgb-md-quote-line) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="newsprint"] main [data-sgb-bubble="novel"] .wrtn-markdown table {
        border-color: rgba(255,238,205,.88) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="newsprint"] main [data-sgb-bubble="novel"] .wrtn-markdown :is(th,td),
      html.${CLS_ACTIVE}[data-sgb-ui-style="newsprint"] main [data-sgb-bubble="novel"] .wrtn-markdown :is(th,td):last-child,
      html.${CLS_ACTIVE}[data-sgb-ui-style="newsprint"] main [data-sgb-bubble="novel"] .wrtn-markdown tr:last-child :is(th,td) {
        border-color: rgba(255,238,205,.76) !important;
      }

      html.${CLS_ACTIVE}[data-sgb-ui-style="newsprint"] main [data-sgb-bubble="novel"] .wrtn-markdown th {
        color: #f0e1c6 !important;
        background: rgba(255,238,205,.22) !important;
      }

      html.${CLS_ACTIVE} main [data-sgb-bubble="novel"],
      html.${CLS_ACTIVE} main [data-sgb-bubble="novel"] > .wrtn-markdown,
      html.${CLS_ACTIVE} main [data-sgb-bubble="novel"] .wrtn-markdown:first-child {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        border: 0 !important;
        outline: 0 !important;
        box-shadow: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }

      html.${CLS_ACTIVE} main [data-sgb-bubble="novel"]::before,
      html.${CLS_ACTIVE} main [data-sgb-bubble="novel"]::after,
      html.${CLS_ACTIVE} main [data-sgb-bubble="novel"] > .wrtn-markdown::before,
      html.${CLS_ACTIVE} main [data-sgb-bubble="novel"] > .wrtn-markdown::after,
      html.${CLS_ACTIVE} main [data-sgb-bubble="novel"] .wrtn-markdown:first-child::before,
      html.${CLS_ACTIVE} main [data-sgb-bubble="novel"] .wrtn-markdown:first-child::after {
        content: none !important;
        display: none !important;
      }

      html.${CLS_ACTIVE} main [data-sgb-novel-group] > .flex > .flex-row {
        border-top-color: transparent !important;
        border-bottom-color: transparent !important;
        box-shadow: none !important;
      }

      html.${CLS_ACTIVE} main .flex-col-reverse > [data-message-group-id][data-sgb-novel-group]:not(:last-child)::before {
        content: var(--sgb-novel-sep-content) !important;
        display: flex !important;
        box-sizing: border-box !important;
        align-items: center !important;
        justify-content: center !important;
        position: static !important;
        width: auto !important;
        min-height: var(--sgb-novel-sep-box-height) !important;
        height: var(--sgb-novel-sep-box-height) !important;
        margin: var(--sgb-novel-sep-margin) !important;
        padding: 0 !important;
        color: var(--sgb-novel-sep-color) !important;
        font-family: var(--sgb-novel-sep-font-family) !important;
        font-size: var(--sgb-novel-sep-font-size) !important;
        font-weight: var(--sgb-novel-sep-font-weight) !important;
        line-height: 1 !important;
        letter-spacing: var(--sgb-novel-sep-letter-spacing) !important;
        text-align: center !important;
        text-shadow: var(--sgb-novel-sep-text-shadow) !important;
        white-space: nowrap !important;
        background: var(--sgb-novel-sep-bg) !important;
        background-repeat: no-repeat !important;
        background-size: 100% 100% !important;
        background-position: center !important;
        border: 0 !important;
        border-top: var(--sgb-novel-sep-border-top) !important;
        border-bottom: var(--sgb-novel-sep-border-bottom) !important;
        box-shadow: var(--sgb-novel-sep-shadow) !important;
        pointer-events: none !important;
        flex: 0 0 auto !important;
      }

      /* ===== 모션 접근성/성능: 동작 줄이기면 새 테마 애니메이션 정지 ===== */
      @media (prefers-reduced-motion: reduce){
        html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-bubble="chat"],
        html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] [data-sgb-bubble="chat"],
        html.${CLS_ACTIVE}[data-sgb-ui-style="najeon"] [data-sgb-bubble="chat"]{animation:none!important}
      }

      /* ===== (선택) 모바일 성능 가드 — 폰에서 말풍선 애니메이션만 끄고 정적 룩 유지 =====
         메시지가 아주 많은 방에서 말풍선마다 애니메이션이 돌아 끊기면 아래 주석을 해제하세요.
         (입력창/추천답변은 항상 정적이라 영향 없음)
      @media (max-width:640px){
        html.${CLS_ACTIVE}[data-sgb-ui-style="cozy"] [data-sgb-bubble="chat"],
        html.${CLS_ACTIVE}[data-sgb-ui-style="codepad"] [data-sgb-bubble="chat"],
        html.${CLS_ACTIVE}[data-sgb-ui-style="najeon"] [data-sgb-bubble="chat"]{animation:none!important}
      }
      */
    `;

    document.head.appendChild(style);
  }

  function isVisibleCrackNativePanel(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.closest(`#${SGB_UI_IDS.modal}`)) return false;
    if (!el.isConnected) return false;
    if (!el.getClientRects().length) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
  }

  function isCrackNativePanelOpen() {
    return Array.from(document.querySelectorAll(
      '[data-radix-popper-content-wrapper], [role="menu"], [role="dialog"], [role="listbox"], [id^="radix-"]'
    )).some(isVisibleCrackNativePanel);
  }

  function isCrackNativePanelNode(node) {
    if (!(node instanceof Element)) return false;
    if (node.closest?.(`#${SGB_UI_IDS.modal}`)) return false;
    return !!(
      node.matches?.('[data-radix-popper-content-wrapper], [role="menu"], [role="dialog"], [role="listbox"], [id^="radix-"]') ||
      node.closest?.('[data-radix-popper-content-wrapper], [role="menu"], [role="dialog"], [role="listbox"], [id^="radix-"]')
    );
  }

  function getGenerateDoneWindow() {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow?.document === document) return unsafeWindow;
    } catch (_) {}
    return window;
  }

  function getGenerateDoneEventName(entry) {
    if (!entry) return '';

    // 형태1: ['event', 'generate_done', ...]
    // 형태2: Arguments(3) {0:'event', 1:'generate_done', 2:{...}}
    // 형태3: { event: 'generate_done', ... }
    if ((Array.isArray(entry) || typeof entry.length === 'number') && entry[0] === 'event') {
      return String(entry[1] || '');
    }
    return String(entry?.event || '');
  }

  function isGenerateDoneEntry(entry) {
    return /^generate_done$/i.test(getGenerateDoneEventName(entry));
  }

  function getGenerateDoneEntryKey(entry) {
    try {
      const meta = ((Array.isArray(entry) || typeof entry.length === 'number') && entry[0] === 'event')
        ? entry[2]
        : entry;
      const msgId = meta?.msg_id || meta?.fe_msg_id || meta?.message_id || meta?.id || '';
      const chatId = meta?.chat_id || meta?.episode_id || '';
      if (msgId) return `${chatId}::${msgId}`;
    } catch (_) {}
    return `time::${Math.floor(Date.now() / 1500)}`;
  }

  function handleGenerateDoneEntry(entry) {
    if (!isGenerateDoneEntry(entry)) return false;

    const eventWindow = getGenerateDoneWindow();
    const key = getGenerateDoneEntryKey(entry);
    if (eventWindow.__sgbLastGenerateDoneKey === key) return true;
    eventWindow.__sgbLastGenerateDoneKey = key;

    onGenerateDoneSignal();
    return true;
  }

  function startGenerateDonePoll() {
    const eventWindow = getGenerateDoneWindow();
    const dl = eventWindow.dataLayer = eventWindow.dataLayer || [];
    if (eventWindow.__sgbDataLayerSeenLen == null) {
      eventWindow.__sgbDataLayerSeenLen = Array.isArray(dl) ? dl.length : 0;
    }

    clearInterval(eventWindow.__sgbGenerateDonePollTimer);
    eventWindow.__sgbGenerateDonePollTimer = setInterval(() => {
      try {
        const pageWindow = getGenerateDoneWindow();
        const layer = pageWindow.dataLayer;
        if (!Array.isArray(layer)) return;

        let seen = Number(pageWindow.__sgbDataLayerSeenLen || 0);
        if (layer.length <= seen) {
          if (layer.length < seen) pageWindow.__sgbDataLayerSeenLen = layer.length;
          return;
        }

        for (let i = seen; i < layer.length; i++) {
          if (handleGenerateDoneEntry(layer[i])) break;
        }
        pageWindow.__sgbDataLayerSeenLen = layer.length;
      } catch (_) {}
    }, 400);
  }

  function installGenerateDoneWatcher() {
    // Crack의 generate_done은 page window의 dataLayer에 들어온다.
    // DOM 스트리밍을 계속 훑는 대신, 완료 신호 뒤 한 번 더 스킨/배경을 정리한다.
    const eventWindow = getGenerateDoneWindow();
    if (eventWindow.__sgbGenerateDonePollOnlyStarted) return;
    eventWindow.__sgbGenerateDonePollOnlyStarted = true;

    startGenerateDonePoll();
  }

  function onGenerateDoneSignal() {
    if (!isEpisodePath()) return;

    // 생성 완료 직후 React가 최종 DOM을 정리할 시간을 조금 준다.
    scheduleDecorate('generate-done', 520);
    scheduleRefresh('generate-done', 700);
  }

  function scheduleDecorate(reason = 'decorate', delay = 120) {
    const guardPanel = delay > 0;
    clearTimeout(state.decorateTimer);
    state.decorateTimer = setTimeout(() => {
      if (guardPanel && isCrackNativePanelOpen()) return;
      try {
        decorateLayout();
      } catch (err) {
        console.warn(`[${SCRIPT_NAME}] decorate failed:`, err);
      }
    }, Math.max(0, Number(delay) || 0));
  }

  function installObservers() {
    if (state.observer) state.observer.disconnect();

    const observerRoot = document.body || document.documentElement;

    state.observer = new MutationObserver(mutations => {
      state.__sgbLastMutationAt = Date.now();
      let shouldRefresh = false;
      let shouldDecorate = false;

      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const target = mutation.target;
          // src 변경만 본다. class/style 전체 감시는 콜백 폭증 원인이어서 제외.
          if (target instanceof Element && target.matches?.('.csp-generated-scene-image img')) {
            shouldRefresh = true;
          }
        } else if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof Element)) continue;
            if (isCrackNativePanelNode(node)) continue;

            const hasSceneImage =
              node.matches?.('.csp-generated-scene-image') ||
              node.querySelector?.('.csp-generated-scene-image');

            const hasLayoutTarget =
              hasSceneImage ||
              node.matches?.('[data-message-group-id], .__chat_input_textarea, #igx-live-popup, .wrtn-codeblock') ||
              node.querySelector?.('[data-message-group-id], .__chat_input_textarea, #igx-live-popup, .wrtn-codeblock') ||
              node.matches?.('[class*="ring-offset-sidebar"], [role="button"]') ||
              !!node.querySelector?.('[class*="ring-offset-sidebar"], [role="button"]');

            if (hasLayoutTarget) shouldDecorate = true;
            if (hasSceneImage) shouldRefresh = true;

            if (shouldRefresh && shouldDecorate) break;
          }
        }

        if (shouldRefresh && shouldDecorate) break;
      }

      if (shouldDecorate) scheduleDecorate('mutation', 650);
      if (shouldRefresh) scheduleRefresh('mutation', 700);
    });

    state.observer.observe(observerRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });

    if (state.themeObserver) state.themeObserver.disconnect();

    state.themeObserver = new MutationObserver(() => {
      state.__sgbDarkCacheAt = 0; // 테마 전환 즉시 재판정
      applyTheme();
      scheduleRefresh('theme', 0);
    });

    state.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode']
    });

    if (document.body) {
      state.themeObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['data-theme', 'data-color-mode']
      });
    }
  }


  function bindEvents() {
    document.addEventListener('click', event => {
      if (handleSameEpisodeSelfClick(event)) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      handleNativeSituationImageToggle(target);
      if (isPotentialNativeSettingsMenuTrigger(target)) scheduleSettingsRowDecorateBurst('native-menu-click');
    }, true);

    document.addEventListener('pointerup', event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (isPotentialNativeSettingsMenuTrigger(target)) scheduleSettingsRowDecorateBurst('native-menu-pointerup');
    }, { capture: true, passive: true });

    document.addEventListener('click', event => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      if (target.closest('.csp-generated-scene-image img, .csp-image-history-btn, .csp-image-history-prev, .csp-image-history-next, .csp-image-reroll-btn, .csp-image-delete-btn, .csp-image-edit-btn')) {
        scheduleRefreshBurst('scene-click');
      }
    }, false);

    window.addEventListener('resize', () => {
      scheduleRefresh('resize', 120);
    });

    window.addEventListener('scroll', () => {
      // 스크롤 중 효과를 끄지 않고, 멈춘 뒤 현재 화면에 가까운 이미지만 다시 확인한다.
      scheduleRefresh('scroll-idle', 260);
    }, { capture: true, passive: true });

    window.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeSettingsModal();
    });

    window.addEventListener('pagehide', () => {
      persistCurrentSettings('pagehide');
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') persistCurrentSettings('visibility-hidden');
    });
  }

  function beginEriRouteHold(reason = 'route') {
    clearTimeout(state.routeHoldTimer);

    if (!CONFIG.eriCompatibilityEnabled || !isChatLikePathForEri()) {
      state.routeHoldUntil = 0;
      return;
    }

    const holdMs = getEriRouteHoldMs();
    state.routeHoldUntil = Date.now() + holdMs;

    const root = document.getElementById(IDS.root);
    if (root instanceof HTMLElement && !hasEriVisibleMenuButton()) {
      parkLayerDuringEriRouteHold(root);
    }

    state.routeHoldTimer = window.setTimeout(() => {
      state.routeHoldUntil = 0;
      const currentRoot = document.getElementById(IDS.root);
      if (currentRoot instanceof HTMLElement) releaseLayerRouteHold(currentRoot);
      scheduleRefresh(`${reason}-eri-hold-release`, 0);
    }, holdMs + 80);
  }

  function handleRouteChange(reason = 'route') {
    if (state.path === location.pathname) return;

    state.path = location.pathname;
    state.roomId = getRoomId();

    beginEriRouteHold(reason);
    clearBackgroundImage();
    scheduleRefreshBurst(reason);

    // 로어 버튼이 늦게 붙는 방끼리 이동에서도 배경은 뒤늦게 정상 복구한다.
    window.setTimeout(() => scheduleRefresh(`${reason}-late-1`, 0), getEriRouteHoldMs() + 180);
    window.setTimeout(() => scheduleRefresh(`${reason}-late-2`, 0), getEriRouteHoldMs() + 1200);
  }

  function installRouteWatcher() {
    if (state.routeWatchInstalled) return;
    state.routeWatchInstalled = true;

    const fire = reason => {
      window.setTimeout(() => handleRouteChange(reason), 0);
      window.setTimeout(() => handleRouteChange(`${reason}-settled`), 120);
    };

    const wrap = name => {
      const original = history[name];
      if (typeof original !== 'function' || original.__sgbBorderlessWrapped) return;

      const wrapped = function (...args) {
        const result = original.apply(this, args);
        fire(name);
        return result;
      };
      wrapped.__sgbBorderlessWrapped = true;
      history[name] = wrapped;
    };

    try {
      wrap('pushState');
      wrap('replaceState');
    } catch (_) {}

    window.addEventListener('popstate', () => fire('popstate'));
    window.addEventListener('hashchange', () => fire('hashchange'));
  }

  function cleanupOldLayer() {
    // 이전 테스트 버전의 같은 ID 레이어/스타일을 제거하고 새로 시작.
    document.getElementById(IDS.root)?.remove();
    document.getElementById(IDS.style)?.remove();

    document.documentElement.classList.remove(CLS_ACTIVE, CLS_ROOM, CLS_IMAGE_ACTIVE, 'csp-sgb-active', 'csp-sgb-room');
    document.body?.classList?.remove('csp-sgb-active', 'csp-sgb-room');
    document.querySelectorAll('[data-sgb-main-host]').forEach(el => el.removeAttribute('data-sgb-main-host'));
    document.getElementById('csp-sgb-root')?.remove();
    document.getElementById('csp-sgb-style')?.remove();
    clearTimeout(state.quoteHealTimer);
    state.quoteHealUntil = 0;
    if (state.quoteWraps instanceof Map) state.quoteWraps.clear();

    document.getElementById(SGB_UI_IDS.row)?.remove();
    document.getElementById(SGB_UI_IDS.modal)?.remove();
    document.querySelectorAll('[data-sgb-header]').forEach(el => el.removeAttribute('data-sgb-header'));
    document.querySelectorAll('[data-sgb-live-ui]').forEach(el => el.removeAttribute('data-sgb-live-ui'));
    document.querySelectorAll('[data-sgb-top-glass-shell]').forEach(el => el.removeAttribute('data-sgb-top-glass-shell'));
    document.querySelectorAll('[data-sgb-suggestion-button]').forEach(el => el.removeAttribute('data-sgb-suggestion-button'));
    document.querySelectorAll('[data-sgb-edit-bubble]').forEach(el => el.removeAttribute('data-sgb-edit-bubble'));
    document.querySelectorAll('[data-sgb-edit-box]').forEach(el => el.removeAttribute('data-sgb-edit-box'));
    document.querySelectorAll('[data-csp-sgb-bubble]').forEach(el => el.removeAttribute('data-csp-sgb-bubble'));
    document.querySelectorAll('[data-csp-sgb-bubble-parent]').forEach(el => el.removeAttribute('data-csp-sgb-bubble-parent'));
    document.querySelectorAll('[data-csp-sgb-input-box]').forEach(el => el.removeAttribute('data-csp-sgb-input-box'));
    document.querySelectorAll('[data-csp-sgb-input-host]').forEach(el => el.removeAttribute('data-csp-sgb-input-host'));
    document.querySelectorAll('[data-csp-sgb-top-glass-shell]').forEach(el => el.removeAttribute('data-csp-sgb-top-glass-shell'));
    document.querySelectorAll('[data-csp-sgb-suggestion-button]').forEach(el => el.removeAttribute('data-csp-sgb-suggestion-button'));

    restoreLargeBackgroundPanels();
  }

  function getEriLoreInjector() {
    try {
      return window.__LoreInj || null;
    } catch (_) {
      return null;
    }
  }

  function isEriLoreInjectorDetected() {
    try {
      return !!(window.__LoreInj || window.__LoreInjReady);
    } catch (_) {
      return false;
    }
  }

  function isChatLikePathForEri(pathname = location.pathname) {
    return /\/stories\/[^/]+\/episodes\/[^/?#]+/i.test(pathname)
      || /\/u\/[^/]+\/c\/[^/?#]+/i.test(pathname)
      || /\/characters\/[^/]+\/chats\/[^/?#]+/i.test(pathname);
  }

  function hasEriVisibleMenuButton() {
    return Array.from(document.querySelectorAll('.burner-button')).some(button => {
      if (!(button instanceof HTMLElement)) return false;
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return rect.width > 4
        && rect.height > 4
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0.01;
    });
  }

  function isEriBootSettled() {
    if (!isChatLikePathForEri()) return true;
    if (hasEriVisibleMenuButton()) return true;
    if (document.getElementById('lore-inj-boot-error')) return true;
    return false;
  }

  function waitForEriDetectionGrace() {
    if (isEriLoreInjectorDetected()) return Promise.resolve(true);

    const graceMs = Math.max(300, Number(CONFIG.eriDetectGraceMs) || 1800);
    const pollMs = Math.max(80, Number(CONFIG.eriBootPollMs) || 120);
    const startedAt = Date.now();

    return new Promise(resolve => {
      const tick = () => {
        if (isEriLoreInjectorDetected()) {
          resolve(true);
          return;
        }

        if (Date.now() - startedAt >= graceMs) {
          resolve(false);
          return;
        }

        window.setTimeout(tick, pollMs);
      };

      tick();
    });
  }

  async function waitForEriLoreInjector() {
    if (!CONFIG.eriCompatibilityEnabled) return 'disabled';
    if (!isChatLikePathForEri()) return 'not-chat-path';

    // 에리 확프가 document-start에서 바로 __LoreInj를 만들지 못한 특수 상황만 짧게 확인.
    // 이 유예 시간 안에도 감지되지 않으면 에리가 없다고 보고 배경 확프를 시작한다.
    const detected = await waitForEriDetectionGrace();
    if (!detected) return 'not-detected';

    // 기존 버전은 에리 메뉴 버튼이 실제로 보일 때까지 무한 대기했다.
    // SPA 이동/다른 확프와의 타이밍 꼬임에서 서로 기다리는 상태가 생길 수 있어,
    // 시작 대기는 짧게만 하고 이후 route-hold에서 main 삽입만 늦춘다.
    if (isEriBootSettled()) return 'ready';

    const pollMs = Math.max(80, Number(CONFIG.eriBootPollMs) || 120);
    const maxWaitMs = Math.max(1000, Number(CONFIG.eriBootMaxWaitMs) || 3600);
    const deadline = Date.now() + maxWaitMs;

    return new Promise(resolve => {
      const tick = () => {
        if (isEriBootSettled()) {
          resolve('ready');
          return;
        }

        if (Date.now() >= deadline) {
          resolve('timeout-start-anyway');
          return;
        }

        window.setTimeout(tick, pollMs);
      };

      tick();
    });
  }

  function protectEriLoreInjectorUi() {
    // 에리 확프는 상단 버튼을 .burner-button으로 붙인다.
    // 이 확프는 버튼을 새로 만들거나 위치를 바꾸지 않고, 배경 레이어보다 위에 보이도록 보호만 한다.
    document.querySelectorAll('.burner-button, #chasm-decentral-menu, #lore-inj-boot-error').forEach(el => {
      if (!(el instanceof HTMLElement)) return;
      el.setAttribute('data-sgb-eri-protected', '');
    });
  }

  function start() {
    applySavedSettingsToConfig();
    cleanupOldLayer();
    installRouteWatcher();
    beginEriRouteHold('initial');
    injectStyle();
    ensureLayer();
    applyCssVars();
    applyTheme();

    installObservers();
    bindEvents();
    installGenerateDoneWatcher();

    state.roomId = getRoomId();

    state.intervalId = setInterval(() => {
      if (document.hidden) return;
      pruneQuoteWraps();

      if (state.path !== location.pathname) {
        handleRouteChange();
        return;
      }

      if (!isEpisodePath()) {
        if (document.documentElement.classList.contains(CLS_ACTIVE)) clearThemeSkin();
        return;
      }

      applyTheme();

      if (!shouldApplyThemeSkin()) {
        if (document.documentElement.classList.contains(CLS_ACTIVE)) clearThemeSkin();
        return;
      }

      protectEriLoreInjectorUi();

      // 주기 체크는 안전망으로만 사용한다. 실제 반응은 MutationObserver/click/scroll/route가 담당.
      // 스트리밍 중엔 안전망을 쉬고 generate_done/observer가 정리하게 둔다.
      if (Date.now() - Number(state.__sgbLastMutationAt || 0) < 1200) return;

      scheduleRefresh('interval', 0);
    }, CONFIG.syncIntervalMs);

    scheduleRefreshBurst('initial');

    window.CSPGeneratedBackgroundBlur = {
      version: VERSION,
      refresh: () => refreshNow('api'),
      clear: clearBackgroundImage,
      openSettings: openSettingsModal,
      setEnabled: setBackgroundEnabled,
      isEnabled: isBackgroundEnabled,
      saveSettings: saveBackgroundSettings,
      setUiStyle: style => saveBackgroundSettings({ uiStyle: style }, { skipRefresh: true }),
      setDarkModeOnly: enabled => {
        CONFIG.darkModeOnly = enabled !== false;
        if (!shouldApplyThemeSkin()) clearThemeSkin();
        else scheduleRefreshBurst('dark-mode-only-change');
      },
      resetSettings: resetBackgroundSettings,
      repairLayer: () => {
        const root = ensureLayer();
        stabilizeLayerRoot(root);
        scheduleRefreshBurst('repair-layer');
      },
      config: CONFIG,
      getState: () => ({
        enabled: CONFIG.enabled,
        roomId: state.roomId,
        path: state.path,
        currentSrcLength: state.currentSrc.length,
        currentSignature: state.currentSignature,
        active: document.documentElement.classList.contains(CLS_ACTIVE),
        imageActive: document.documentElement.classList.contains(CLS_IMAGE_ACTIVE),
        source: document.documentElement.getAttribute('data-sgb-source') || ''
      })
    };
  }

  const START_DELAY_MS = 900; // 기본 짧은 지연 + 에리 확프 감지 시에도 유한 대기만 수행

  function startDelayed() {
    window.setTimeout(async () => {
      await waitForEriLoreInjector();
      start();
      protectEriLoreInjectorUi();
      window.setTimeout(protectEriLoreInjectorUi, 900);
      window.setTimeout(protectEriLoreInjectorUi, 2200);
    }, START_DELAY_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startDelayed, { once: true });
  } else {
    startDelayed();
  }
})();
