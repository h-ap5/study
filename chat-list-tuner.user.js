// ==UserScript==
// @name         📑 Crack Chat List Tuner + 폴더
// @namespace    chat list tuner
// @version      1.7.3
// @description  채팅방 목록 튜너에 로컬 폴더(우클릭·한눈에 보기에서 넣기), 색상별 모아보기, 이 방에서 찾기(채팅방 내부 검색 합본 · 북마크 · 형광펜 노트 합본)를 통합합니다.
// @match        *://crack.wrtn.ai/*
// @grant        none
// @run-at       document-start
// ==/UserScript==


(function () {
    'use strict';
    if (window.__crackChatListTunerRunning) return;
    window.__crackChatListTunerRunning = true;

    // 크랙 앱이 API를 호출할 때 사용하는 인증 관련 헤더를 브라우저 내부에서만 재사용합니다.
    // 캡처한 값은 외부로 출력하지 않고, 같은 crack-api.wrtn.ai 검색 API 호출에만 사용합니다.
    const CRACK_AUTH_CAPTURE = {
        headers: {},
        capturedAt: 0,
        waiters: []
    };

    function isCrackApiUrl(url) {
        try {
            return new URL(String(url || ''), location.origin).origin === 'https://crack-api.wrtn.ai';
        } catch {
            return false;
        }
    }

    function isReusableAuthHeader(name) {
        return String(name || '').toLowerCase() === 'authorization';
    }
    function rememberAuthHeader(name, value) {
        if (!isReusableAuthHeader(name)) return;
        if (value == null || value === '') return;

        CRACK_AUTH_CAPTURE.headers[String(name).toLowerCase()] = String(value);
        CRACK_AUTH_CAPTURE.capturedAt = Date.now();

        const waiters = CRACK_AUTH_CAPTURE.waiters.splice(0);
        waiters.forEach(resolve => resolve(true));
    }


    // 직접 API 호출 시에는 authorization 토큰 하나만 보낸다.
    // x-wrtn-id 등 캡처된 다른 헤더가 섞이면 크랙 서버가 401로 거부할 수 있다.
    function getAuthHeaderOnly() {
        const h = CRACK_AUTH_CAPTURE.headers;
        const token = h['authorization'] || h['Authorization'];
        return token ? { authorization: token } : {};
    }


    function hasAuthToken() {
        return !!(CRACK_AUTH_CAPTURE.headers['authorization'] || CRACK_AUTH_CAPTURE.headers['Authorization']);
    }

    function waitForAuthToken(timeout = 6000) {
        if (hasAuthToken()) return Promise.resolve(true);

        return new Promise(resolve => {
            const timer = setTimeout(() => {
                const idx = CRACK_AUTH_CAPTURE.waiters.indexOf(done);
                if (idx >= 0) CRACK_AUTH_CAPTURE.waiters.splice(idx, 1);
                resolve(false);
            }, timeout);

            function done(value) {
                clearTimeout(timer);
                resolve(value);
            }

            CRACK_AUTH_CAPTURE.waiters.push(done);
        });
    }


    function headersToEntries(headers) {
        const entries = [];
        if (!headers) return entries;

        try {
            if (headers instanceof Headers) {
                headers.forEach((value, key) => entries.push([key, value]));
                return entries;
            }
        } catch {}

        if (Array.isArray(headers)) {
            for (const pair of headers) {
                if (Array.isArray(pair) && pair.length >= 2) entries.push([pair[0], pair[1]]);
            }
            return entries;
        }

        if (typeof headers === 'object') {
            for (const [key, value] of Object.entries(headers)) entries.push([key, value]);
        }

        return entries;
    }

    function captureHeadersFromFetch(input, init) {
        const url = input instanceof Request ? input.url : String(input || '');
        if (!isCrackApiUrl(url)) return;

        try {
            if (input instanceof Request) {
                headersToEntries(input.headers).forEach(([key, value]) => rememberAuthHeader(key, value));
            }
        } catch {}

        try {
            headersToEntries(init?.headers).forEach(([key, value]) => rememberAuthHeader(key, value));
        } catch {}
    }

    function isArchiveMutationRequest(input, init = {}) {
        const url = input instanceof Request ? input.url : String(input || '');
        if (!isCrackApiUrl(url)) return false;

        const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;

        let pathname = '';
        try {
            pathname = new URL(url, location.origin).pathname.toLowerCase();
        } catch {}

        // 자동 정리 미리보기 생성은 POST지만 서버 데이터를 바꾸지 않는다.
        // 이를 변경 요청으로 취급하면 스마트 정리 도중 전체 개수 조회가 중복 실행된다.
        if (pathname.endsWith('/chat-folders/auto-organize/preview')) return false;

        // 보관함 생성/삭제/자동 정리/채팅 이동 API는 보통 chat-folders 계열을 사용한다.
        if (pathname.includes('chat-folder') || pathname.includes('chat_folder') || pathname.includes('/archive')) {
            return true;
        }

        // 채팅 수정 API 본문에 폴더 ID가 실리는 구조도 함께 잡는다.
        const body = init?.body;
        if (typeof body === 'string' && /(?:chatFolderId|folderId|folder_id)/i.test(body)) return true;

        try {
            if (body instanceof URLSearchParams || body instanceof FormData) {
                for (const key of body.keys()) {
                    if (/^(?:chatFolderId|folderId|folder_id)$/i.test(String(key))) return true;
                }
            }
        } catch {}

        return false;
    }

    function markArchiveDataChanged() {
        // 현재 숫자와 검색 인덱스를 낡은 상태로 표시하고 서버 반영 뒤 정확한 값을 다시 읽는다.
        archiveSearchState.countUpdatedAt = 0;
        archiveSearchState.refreshedThisPage = false;
        scheduleCountRefresh(true);
    }

    function installAuthHeaderCapture() {
        try {
            const originalFetch = window.fetch;
            if (typeof originalFetch === 'function' && !originalFetch.__crackUiAuthCapture) {
                const wrappedFetch = function(input, init) {
                    captureHeadersFromFetch(input, init);
                    const refreshArchiveCount = isArchiveMutationRequest(input, init);
                    const request = originalFetch.apply(this, arguments);

                    if (refreshArchiveCount) {
                        Promise.resolve(request).then(response => {
                            if (response?.ok) markArchiveDataChanged();
                        }).catch(() => {});
                    }

                    return request;
                };
                wrappedFetch.__crackUiAuthCapture = true;
                wrappedFetch.__originalFetch = originalFetch;
                window.fetch = wrappedFetch;
            }
        } catch (error) {
            console.warn('[Crack UI] fetch 인증 헤더 캡처 설치 실패:', error);
        }

        try {
            const proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
            if (proto && !proto.__crackUiAuthCapture) {
                const originalOpen = proto.open;
                const originalSetRequestHeader = proto.setRequestHeader;
                const originalSend = proto.send;

                proto.open = function(method, url) {
                    this.__crackUiRequestUrl = String(url || '');
                    this.__crackUiRequestMethod = String(method || 'GET');
                    return originalOpen.apply(this, arguments);
                };

                proto.setRequestHeader = function(name, value) {
                    if (isCrackApiUrl(this.__crackUiRequestUrl)) {
                        rememberAuthHeader(name, value);
                    }
                    return originalSetRequestHeader.apply(this, arguments);
                };

                proto.send = function(body) {
                    const refreshArchiveCount = isArchiveMutationRequest(this.__crackUiRequestUrl, {
                        method: this.__crackUiRequestMethod,
                        body
                    });

                    if (refreshArchiveCount) {
                        this.addEventListener('loadend', () => {
                            if (this.status >= 200 && this.status < 300) markArchiveDataChanged();
                        }, { once: true });
                    }

                    return originalSend.apply(this, arguments);
                };

                proto.__crackUiAuthCapture = true;
            }
        } catch (error) {
            console.warn('[Crack UI] XHR 인증 헤더 캡처 설치 실패:', error);
        }
    }

    installAuthHeaderCapture();

    function addCrackStyle(css) {
        const style = document.createElement('style');
        style.textContent = css;
        const mount = () => (document.head || document.documentElement)?.appendChild(style);
        if (document.documentElement) mount();
        else document.addEventListener('DOMContentLoaded', mount, { once: true });
        return style;
    }
    // 로컬 스토리지 키값
    const STORAGE_KEY = 'crackColor_episode_v10_';
    const ARCHIVE_HEIGHT_KEY = 'crack_archive_h';
    const ARCHIVE_HEIGHT_MIN = 50;
    const ARCHIVE_HEIGHT_DEFAULT = 284;

    // 보관함 및 채팅 목록 제목 검색 인덱스
    const ARCHIVE_SEARCH_CACHE_KEY = 'crackUnifiedTitleSearchIndex_v6_overlay';
    const ARCHIVE_SEARCH_CACHE_TTL = 30 * 60 * 1000; // 30분
    const CRACK_API_BASE = 'https://crack-api.wrtn.ai';
    const API_PAGE_LIMIT = 40;
    const API_CONCURRENCY = 4;
    const MAX_ARCHIVE_FOLDERS = 80;
    const MAX_ARCHIVE_CHATS = 3000;
    const MAX_ARCHIVE_RESULTS = 200;
    const SMART_ORGANIZE_LOAD_CONCURRENCY = 4;

    // 커스텀 팔레트 색상 정의
    const colorValues = {
        rose: '#d87791',
        gold: '#c9ab55',
        emerald: '#65b984',
        teal: '#67b9c0',
        violet: '#b188c7'
    };

    // 사용자가 추가한 색. 키는 'c_' + 6자리 hex라서 같은 색은 한 번만 들어간다.
    const CUSTOM_COLOR_KEY = 'crackTunerCustomColors_v1';
    const customColorKeys = [];

    // 색상은 폴더와 별개인 표시다. 이름은 사용자가 한눈에 보기의 색상별 묶음에서 바꿀 수 있다.
    const COLOR_LABEL_KEY = 'crackTunerColorLabels_v1';
    const DEFAULT_COLOR_LABELS = { rose: '분홍', gold: '노랑', emerald: '초록', teal: '청록', violet: '보라' };
    let colorVersion = 0;

    function colorLabel(key) {
        try {
            const saved = JSON.parse(localStorage.getItem(COLOR_LABEL_KEY) || '{}');
            const name = typeof saved?.[key] === 'string' ? saved[key].trim() : '';
            if (name) return name;
        } catch (e) {}
        if (DEFAULT_COLOR_LABELS[key]) return DEFAULT_COLOR_LABELS[key];
        const customIndex = customColorKeys.indexOf(key);
        return customIndex >= 0 ? `내 색 ${customIndex + 1}` : key;
    }

    function saveColorLabel(key, name) {
        if (!colorValues[key]) return;
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem(COLOR_LABEL_KEY) || '{}') || {}; } catch (e) {}
        const next = String(name || '').trim().slice(0, 20);
        if (!next || next === DEFAULT_COLOR_LABELS[key]) delete saved[key];
        else saved[key] = next;
        try { localStorage.setItem(COLOR_LABEL_KEY, JSON.stringify(saved)); } catch (e) {}
        colorVersion++;
    }

    // 테마별(다크/라이트) 배경 투명도 및 발광(Glow) 효과 정의
    const themeColorSets = {
        dark: {
            accents: {
                rose: '#d87791',
                gold: '#c9ab55',
                emerald: '#65b984',
                teal: '#67b9c0',
                violet: '#b188c7'
            },
            backgrounds: {
                rose: 'rgba(74, 30, 42, 0.72)',
                gold: 'rgba(76, 64, 30, 0.70)',
                emerald: 'rgba(27, 62, 47, 0.72)',
                teal: 'rgba(25, 59, 66, 0.72)',
                violet: 'rgba(58, 42, 68, 0.72)'
            },
            borders: {
                rose: 'rgba(216, 119, 145, 0.24)',
                gold: 'rgba(201, 171, 85, 0.23)',
                emerald: 'rgba(101, 185, 132, 0.22)',
                teal: 'rgba(103, 185, 192, 0.22)',
                violet: 'rgba(177, 136, 199, 0.23)'
            },
            glows: {
                rose: 'rgba(216, 119, 145, 0.26)',
                gold: 'rgba(201, 171, 85, 0.24)',
                emerald: 'rgba(101, 185, 132, 0.23)',
                teal: 'rgba(103, 185, 192, 0.23)',
                violet: 'rgba(177, 136, 199, 0.25)'
            }
        },
        light: {
            accents: {
                rose: '#c85f7b',
                gold: '#aa852c',
                emerald: '#459b68',
                teal: '#3f929c',
                violet: '#8f67a4'
            },
            backgrounds: {
                rose: 'rgba(255, 133, 162, 0.15)',
                gold: 'rgba(214, 172, 64, 0.17)',
                emerald: 'rgba(92, 174, 122, 0.14)',
                teal: 'rgba(83, 172, 184, 0.14)',
                violet: 'rgba(177, 136, 199, 0.15)'
            },
            borders: {
                rose: 'rgba(200, 95, 123, 0.22)',
                gold: 'rgba(170, 133, 44, 0.22)',
                emerald: 'rgba(69, 155, 104, 0.20)',
                teal: 'rgba(63, 146, 156, 0.20)',
                violet: 'rgba(143, 103, 164, 0.21)'
            },
            glows: {
                rose: 'rgba(200, 95, 123, 0.18)',
                gold: 'rgba(170, 133, 44, 0.16)',
                emerald: 'rgba(69, 155, 104, 0.16)',
                teal: 'rgba(63, 146, 156, 0.16)',
                violet: 'rgba(143, 103, 164, 0.17)'
            }
        }
    };

    function hexToRgb(hex) {
        const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
        if (!match) return null;
        const n = parseInt(match[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function rgbToHex(rgb) {
        return '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
    }

    // 기본 5색과 같은 규칙으로 다크/라이트의 배경·테두리·빛 번짐 값을 만든다.
    function registerCustomColor(key, hex) {
        const rgb = hexToRgb(hex);
        if (!rgb) return false;
        const [r, g, b] = rgb;
        const deep = rgb.map(v => Math.round(v * 0.86));
        const dark = themeColorSets.dark;
        const light = themeColorSets.light;
        colorValues[key] = rgbToHex(rgb);
        dark.accents[key] = rgbToHex(rgb);
        dark.backgrounds[key] = `rgba(${Math.round(r * 0.3 + 14)}, ${Math.round(g * 0.3 + 14)}, ${Math.round(b * 0.3 + 13)}, 0.72)`;
        dark.borders[key] = `rgba(${r}, ${g}, ${b}, 0.23)`;
        dark.glows[key] = `rgba(${r}, ${g}, ${b}, 0.25)`;
        light.accents[key] = rgbToHex(deep);
        light.backgrounds[key] = `rgba(${r}, ${g}, ${b}, 0.15)`;
        light.borders[key] = `rgba(${deep.join(', ')}, 0.21)`;
        light.glows[key] = `rgba(${deep.join(', ')}, 0.17)`;
        if (!customColorKeys.includes(key)) customColorKeys.push(key);
        return true;
    }

    function loadCustomColors() {
        let list = [];
        try { list = JSON.parse(localStorage.getItem(CUSTOM_COLOR_KEY) || '[]'); } catch (e) {}
        if (!Array.isArray(list)) return;
        for (const entry of list.slice(0, 24)) {
            if (entry && /^c_[0-9a-f]{6}$/.test(String(entry.key)) && !colorValues[entry.key]) registerCustomColor(entry.key, entry.hex);
        }
    }

    function saveCustomColors() {
        try {
            localStorage.setItem(CUSTOM_COLOR_KEY, JSON.stringify(customColorKeys.map(key => ({ key, hex: colorValues[key] }))));
            return true;
        } catch (e) {
            return false;
        }
    }

    function isCustomColor(key) {
        return customColorKeys.includes(key);
    }

    // 같은 색이 이미 있으면 그 색을 돌려준다(기본 5색 포함).
    function addCustomColor(hex) {
        const rgb = hexToRgb(hex);
        if (!rgb) return '';
        const value = rgbToHex(rgb);
        const same = Object.keys(colorValues).find(key => String(colorValues[key]).toLowerCase() === value);
        if (same) return same;
        if (customColorKeys.length >= 24) {
            showTunerToast('색은 24개까지 추가할 수 있어요');
            return '';
        }
        const key = 'c_' + value.slice(1);
        registerCustomColor(key, value);
        if (!saveCustomColors()) showTunerToast('브라우저 저장공간이 가득 차서 새 색을 저장하지 못했어요');
        colorVersion++;
        return key;
    }

    // 지운 색으로 칠한 채팅방은 색 없음으로 돌린다.
    function removeCustomColor(key) {
        if (!isCustomColor(key)) return;
        customColorKeys.splice(customColorKeys.indexOf(key), 1);
        delete colorValues[key];
        for (const set of [themeColorSets.dark, themeColorSets.light]) {
            for (const part of Object.values(set)) delete part[key];
        }
        try {
            const drop = [];
            for (let i = 0; i < localStorage.length; i++) {
                const name = localStorage.key(i);
                if (name && name.startsWith(STORAGE_KEY) && localStorage.getItem(name) === key) drop.push(name);
            }
            drop.forEach(name => localStorage.removeItem(name));
        } catch (e) {}
        try {
            const labels = JSON.parse(localStorage.getItem(COLOR_LABEL_KEY) || '{}') || {};
            if (labels[key]) {
                delete labels[key];
                localStorage.setItem(COLOR_LABEL_KEY, JSON.stringify(labels));
            }
        } catch (e) {}
        saveCustomColors();
        colorVersion++;
    }

    // 브라우저 기본 색 선택 창을 연다. 입력칸은 body에 두어 크랙 메뉴가 닫혀도 남는다.
    function pickCustomColor(anchor, onPick) {
        let input = document.getElementById('crack-color-picker-input');
        if (!input) {
            input = document.createElement('input');
            input.type = 'color';
            input.id = 'crack-color-picker-input';
            input.tabIndex = -1;
            input.setAttribute('aria-hidden', 'true');
            input.style.cssText = 'position:fixed;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none;z-index:2147483646;';
            document.body.appendChild(input);
        }
        const rect = anchor?.getBoundingClientRect?.();
        input.style.left = `${Math.round(rect ? rect.left : window.innerWidth / 2)}px`;
        input.style.top = `${Math.round(rect ? rect.bottom : window.innerHeight / 2)}px`;
        input.value = '#7aa2f7';
        input.onchange = () => {
            const key = addCustomColor(input.value);
            if (key) onPick(key);
        };
        try {
            if (typeof input.showPicker === 'function') input.showPicker();
            else input.click();
        } catch (e) {
            input.click();
        }
    }

    loadCustomColors();

    let lastMenuTarget = null;
    let lastMenuTime = 0;
    let updateTimer = null;
    let isUpdatingUI = false; // DOM 중복 트리거 방지 플래그

    // 보관함 DOM은 React 재렌더 때만 바뀌므로 매 Mutation마다 전체 탐색하지 않도록 캐시합니다.
    let cachedArchiveDivider = null;
    let cachedArchiveContainer = null;
    let lastArchiveScrollTarget = null;
    let lastArchiveAppliedHeight = 0;
    let archiveFastApplyRaf = 0;

    const archiveSearchState = {
        items: [],
        status: 'idle', // idle | ready | indexing | error
        inFlight: null,
        started: false,
        loadedFolders: 0,
        totalFolders: 0,
        loadedChats: 0,
        totalArchiveChats: null,
        totalRootChats: null,
        totalAllChats: null,
        countUpdatedAt: 0,
        countStatus: 'idle', // idle | loading | ready | error
        savedAt: 0,
        partial: false,
        lastError: '',
        lastFailedAt: 0,
        lastRenderKey: '',
        lastResultKey: ''
    };
    let archiveCountRefreshPending = false;

    const smartOrganizeState = {
        runId: 0,
        open: false,
        busy: false,
        phase: 'idle', // idle | loading | review | preparing | applying | done | error
        previewId: '',
        rows: [],
        status: '',
        singletonStatus: 'idle', // idle | ready | error
        singletonCount: 0,
        singletonError: '',
        result: null
    };

    // React 재렌더 중에도 검색어가 날아가지 않도록 별도 상태로 보관합니다.
    let currentSearchQueryRaw = '';
    // 기존 제목/스토리명 검색을 기본값으로 두고, 선택 시에만 최근 메시지도 검색합니다.
    let includeRecentMessages = false;
    // 검색 입력창이 React 재렌더로 "새로 만들어진 것"인지 판별하기 위한 기준.
    let lastSearchInputEl = null;
    let legacySearchCleanupDone = false;
    const chatVisualCache = new WeakMap();

    // 검색 입력 직후 즉시 무거운 DOM/API 결과 렌더를 돌리면 한글 입력 중 포커스/조합이 끊길 수 있다.
    // 입력 중 과도한 렌더링을 막기 위해 짧은 지연 후 검색을 적용합니다.
    const SEARCH_DEBOUNCE_MS = 30;
    let searchDebounceTimer = null;
    let isSearchComposing = false;
    let searchOverlayPositionTimer = null;
    let archiveSearchRenderRaf = 0;

    function getThemeColors() {
        const theme = document.body.getAttribute('data-theme') || 'dark';
        return themeColorSets[theme] || themeColorSets.dark;
    }

    // 스타일 주입 (v1.2.0 전면 리디자인: 먹색 단일 포인트 + 프로필 링)
    addCrackStyle(`
        body {
            --ct-ease: cubic-bezier(.2, .8, .2, 1);
            --ct-spring: cubic-bezier(.34, 1.56, .64, 1);
            --ct-soft: cubic-bezier(.22, 1.2, .36, 1);
        }
        body:not([data-theme="light"]) {
            --ct-bg: #18181b;
            --ct-canvas: #141417;
            --ct-raise: #202024;
            --ct-field: rgba(255, 255, 255, 0.06);
            --ct-tint: rgba(255, 255, 255, 0.03);
            --ct-sunk: rgba(0, 0, 0, 0.3);
            --ct-knob: #303036;
            --ct-hover: rgba(255, 255, 255, 0.05);
            --ct-hover2: rgba(255, 255, 255, 0.085);
            --ct-text: #f1f1f3;
            --ct-muted: #9a9aa3;
            --ct-faint: #62626b;
            --ct-line: rgba(255, 255, 255, 0.07);
            --ct-line2: rgba(255, 255, 255, 0.13);
            --ct-ink: #f1f1f3;
            --ct-ink-fg: #18181b;
            --ct-ring: rgba(255, 255, 255, 0.14);
            --ct-current: rgba(255, 255, 255, 0.075);
            --ct-menu: #212125;
            --ct-shadow: 0 16px 40px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.3);
            --ct-shadow-lg: 0 30px 80px rgba(0, 0, 0, 0.6);
            --ct-lift: 0 10px 24px -12px rgba(0, 0, 0, 0.7);
            --ct-danger: #f08a9b;
            --ct-scrim: rgba(6, 6, 8, 0.55);
        }
        body[data-theme="light"] {
            --ct-bg: #ffffff;
            --ct-canvas: #f6f6f7;
            --ct-raise: #ffffff;
            --ct-field: rgba(0, 0, 0, 0.05);
            --ct-tint: #f6f6f8;
            --ct-sunk: #ececef;
            --ct-knob: #ffffff;
            --ct-hover: rgba(0, 0, 0, 0.04);
            --ct-hover2: rgba(0, 0, 0, 0.065);
            --ct-text: #18181b;
            --ct-muted: #6b6b74;
            --ct-faint: #a3a3ab;
            --ct-line: rgba(0, 0, 0, 0.075);
            --ct-line2: rgba(0, 0, 0, 0.12);
            --ct-ink: #18181b;
            --ct-ink-fg: #ffffff;
            --ct-ring: rgba(0, 0, 0, 0.1);
            --ct-current: rgba(0, 0, 0, 0.055);
            --ct-menu: #ffffff;
            --ct-shadow: 0 16px 40px rgba(20, 16, 40, 0.14), 0 2px 6px rgba(20, 16, 40, 0.06);
            --ct-shadow-lg: 0 30px 70px rgba(20, 16, 40, 0.2);
            --ct-lift: 0 10px 24px -14px rgba(20, 16, 40, 0.35);
            --ct-danger: #c9566b;
            --ct-scrim: rgba(24, 24, 27, 0.3);
        }

        /* 1. 검색창 + 한눈에 보기 버튼 */
        .crack-search-container {
            display: flex;
            align-items: center;
            gap: 6px;
            margin: 8px 10px 10px;
            position: relative;
        }
        .crack-search-box {
            flex: 1;
            min-width: 0;
            display: flex;
            align-items: center;
            gap: 8px;
            height: 36px;
            box-sizing: border-box;
            padding: 0 6px 0 11px;
            background: var(--ct-field);
            border: 0;
            border-radius: 11px;
            transition: background-color 180ms, box-shadow 180ms var(--ct-ease);
        }
        .crack-search-box:focus-within {
            background: var(--ct-raise);
            box-shadow: 0 0 0 1px var(--ct-line2), 0 0 0 4px var(--ct-ring);
        }
        .crack-search-icon {
            color: var(--ct-faint);
            flex-shrink: 0;
            display: flex;
            align-items: center;
            transition: color 180ms, transform 220ms var(--ct-spring);
        }
        .crack-search-box:focus-within .crack-search-icon {
            color: var(--ct-text);
            transform: scale(1.1);
        }
        .crack-search-input {
            width: 100%;
            min-width: 0;
            background: transparent;
            border: none;
            outline: none;
            font-size: 13px;
            color: var(--ct-text);
        }
        .crack-search-input::placeholder { color: var(--ct-faint); }
        .crack-search-clear {
            width: 24px;
            height: 24px;
            flex: 0 0 24px;
            display: grid;
            place-items: center;
            padding: 0;
            border: 0;
            border-radius: 7px;
            background: transparent;
            color: var(--ct-muted);
            font-size: 11px;
            line-height: 1;
            cursor: pointer;
            opacity: 0;
            pointer-events: none;
            transform: scale(.6);
            transition: opacity 140ms, transform 220ms var(--ct-spring), background-color 140ms;
        }
        .crack-search-clear.visible {
            opacity: 1;
            pointer-events: auto;
            transform: none;
        }
        .crack-search-clear:hover {
            background: var(--ct-hover2);
            color: var(--ct-text);
        }
        .crack-lounge-btn {
            display: grid;
            width: 36px;
            height: 36px;
            flex: 0 0 36px;
            place-items: center;
            padding: 0;
            border: 0;
            border-radius: 11px;
            background: var(--ct-field);
            color: var(--ct-text);
            cursor: pointer;
            transition: background-color 150ms, transform 120ms;
        }
        @media (hover: hover) and (pointer: fine) and (min-width: 900px) {
            .crack-lounge-btn { display: grid; }
        }
        .crack-lounge-btn:hover,
        .crack-lounge-btn[aria-expanded="true"] { background: var(--ct-hover2); }
        .crack-lounge-btn:active { transform: scale(.94); }
        .crack-lounge-btn:focus-visible { outline: 2px solid var(--ct-ink); outline-offset: 2px; }
        .crack-lounge-btn rect { transition: transform 300ms var(--ct-spring); }
        .crack-lounge-btn:hover .ct-g1 { transform: translate(-1.3px, -1.3px); }
        .crack-lounge-btn:hover .ct-g2 { transform: translate(1.3px, -1.3px); }
        .crack-lounge-btn:hover .ct-g3 { transform: translate(-1.3px, 1.3px); }
        .crack-lounge-btn:hover .ct-g4 { transform: translate(1.3px, 1.3px); }

        /* 2. 보관함/채팅 목록 개수 */
        .crack-section-count {
            display: inline-flex;
            align-items: center;
            height: 18px;
            padding: 0 2px;
            border: 0;
            background: none;
            color: var(--ct-faint);
            font-size: 12px;
            font-weight: 600;
            font-variant-numeric: tabular-nums;
            line-height: 1;
            white-space: nowrap;
            box-sizing: border-box;
            flex: 0 0 auto;
            transition: color 180ms;
        }
        .crack-section-count[data-kind="archive"] { margin-left: 6px; }
        .crack-section-count[data-kind="root"] { margin-left: auto; margin-right: 8px; }
        .crack-section-count[data-state="ready"] { color: var(--ct-muted); }
        .crack-section-count[data-state="loading"] { animation: ctPulse 1.2s ease-in-out infinite; }
        @keyframes ctPulse { 50% { opacity: .4; } }

        /* 검색 결과는 오버레이에서만 렌더링 (컨테이너 안 구버전 요소는 숨김) */
        .crack-search-container .crack-api-search-status,
        .crack-search-container .crack-api-search-results { display: none !important; }

        /* 3. 검색 결과 오버레이 */
        #crack-search-overlay {
            display: none;
            position: fixed;
            z-index: 9990;
            box-sizing: border-box;
            padding: 2px 10px 88px;
            overflow-y: auto;
            overflow-x: hidden;
            overscroll-behavior: contain;
            background: var(--ct-bg);
            color: var(--ct-text);
        }
        #crack-search-overlay.visible {
            display: block;
            animation: ctOverlayIn 220ms var(--ct-ease) both;
        }
        #crack-search-overlay .crack-search-tools {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin: 4px 4px 2px;
        }
        #crack-search-overlay .crack-search-message-toggle,
        #crack-search-overlay .crack-search-refresh {
            min-height: 26px;
            box-sizing: border-box;
            padding: 4px 8px;
            border: 1px solid transparent;
            border-radius: 7px;
            background: transparent;
            color: var(--ct-muted);
            font-size: 11px;
            font-weight: 600;
            line-height: 1.2;
            cursor: pointer;
        }
        #crack-search-overlay .crack-search-message-toggle[aria-pressed="true"],
        #crack-search-overlay .crack-search-message-toggle:hover,
        #crack-search-overlay .crack-search-refresh:hover {
            border-color: var(--ct-line2);
            background: var(--ct-hover2);
            color: var(--ct-text);
        }
        #crack-search-overlay .crack-search-message-toggle:focus-visible,
        #crack-search-overlay .crack-search-refresh:focus-visible {
            outline: 2px solid var(--ct-ink);
            outline-offset: 2px;
        }
        #crack-search-overlay .crack-search-refresh:disabled {
            opacity: .45;
            cursor: default;
        }
        @keyframes ctOverlayIn {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: none; }
        }
        #crack-search-overlay .crack-api-search-status {
            display: block;
            visibility: hidden;
            min-height: 15px;
            margin: 6px 4px 4px;
            padding: 0;
            font-size: 11px;
            line-height: 1.35;
            color: var(--ct-faint);
            background: transparent;
            border: 0;
        }
        #crack-search-overlay .crack-api-search-status.visible { visibility: visible; }
        #crack-search-overlay .crack-api-search-results {
            display: none;
            margin: 0;
            padding: 0;
            overflow: visible !important;
            max-height: none !important;
        }
        #crack-search-overlay .crack-api-search-results.visible {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        #crack-search-overlay .crack-api-result-header {
            display: flex;
            align-items: center;
            gap: 6px;
            margin: 12px 4px 6px;
            color: var(--ct-muted);
            font-size: 11.5px;
            font-weight: 680;
        }
        #crack-search-overlay .crack-api-result-header:first-child { margin-top: 4px; }
        #crack-search-overlay .crack-api-result-item {
            width: 100%;
            box-sizing: border-box;
            display: flex;
            gap: 10px;
            align-items: center;
            padding: 8px;
            border: 0;
            border-radius: 11px;
            background: transparent;
            color: var(--ct-text);
            text-align: left;
            cursor: pointer;
            transition: background-color 140ms;
        }
        #crack-search-overlay .crack-api-result-item:hover,
        #crack-search-overlay .crack-api-result-item:focus-visible {
            background: var(--ct-hover);
            outline: none;
        }
        #crack-search-overlay .crack-api-result-item:active { transform: scale(.99); }
        .crack-api-result-thumb {
            width: 32px;
            height: 32px;
            flex: 0 0 32px;
            border-radius: 50%;
            overflow: hidden;
            background: var(--ct-hover2);
        }
        .crack-api-result-thumb img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }
        .crack-api-result-main {
            min-width: 0;
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .crack-api-result-title {
            font-size: 12.5px;
            font-weight: 640;
            line-height: 1.25;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .crack-api-result-meta,
        .crack-api-result-snippet {
            font-size: 11px;
            line-height: 1.25;
            color: var(--ct-muted);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* 4. 채팅방 줄: 색 = 프로필 테두리 고리 + 옅은 배경 */
        .crack-chat-item {
            position: relative !important;
            border-radius: 12px !important;
            transition: background-color 180ms var(--ct-ease) !important;
        }
        .crack-chat-item:not([data-chat-color]):not(.crack-current-chat):hover {
            background-color: var(--ct-hover) !important;
        }
        .crack-chat-item[data-chat-color] {
            background-color: color-mix(in srgb, var(--crack-color-bg) 40%, transparent) !important;
        }
        .crack-chat-item[data-chat-color]:hover {
            background-color: color-mix(in srgb, var(--crack-color-bg) 72%, transparent) !important;
        }
        .crack-chat-item > span.rounded-full:first-child {
            outline: 2px solid transparent;
            outline-offset: 0;
            transition: outline-color 220ms, outline-offset 320ms var(--ct-spring);
        }
        .crack-chat-item[data-chat-color] > span.rounded-full:first-child {
            outline-color: var(--crack-accent);
            outline-offset: 2px;
        }
        .crack-current-chat {
            background-color: var(--ct-current) !important;
        }
        .crack-current-chat[data-chat-color] {
            background-color: color-mix(in srgb, var(--crack-color-bg) 85%, transparent) !important;
        }
        .crack-current-chat .typo-text-sm_leading-none_medium { font-weight: 760; }
        .crack-chat-item:focus-visible {
            outline: 2px solid var(--ct-ink) !important;
            outline-offset: -2px !important;
        }
        .crack-chat-item:active { opacity: .9; }

        .crack-so-thumb { overflow: hidden; }
        .crack-so-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        #crack-search-overlay .crack-api-result-preview {
            display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
            font-size: 12px; line-height: 1.4; color: var(--ct-muted);
        }
        .custom-palette-dot { padding: 0; border: 0; flex-shrink: 0; }
        .custom-palette-dot:focus-visible { outline: 2px solid var(--ct-ink); outline-offset: 3px; }
        .crack-menu-solid[role="menu"][data-state="open"] {
            opacity: 1 !important; visibility: visible !important; animation: none !important;
        }
        /* 5. 채팅방 메뉴 + 색 팔레트 */
        .crack-menu-solid {
            background: var(--ct-menu, #212125) !important;
            border: 1px solid var(--ct-line2) !important;
            border-radius: 14px !important;
            box-shadow: var(--ct-shadow) !important;
            z-index: 999999 !important;
        }
        .custom-palette-container {
            display: flex;
            gap: 9px;
            padding: 8px 8px 4px;
            align-items: center;
            margin: 6px 0 0;
            border: 0;
            border-top: 1px solid var(--ct-line);
            background: transparent;
        }
        .custom-palette-container::before {
            content: '색상';
            margin-right: auto;
            font-size: 11.5px;
            color: var(--ct-faint);
        }
        .custom-palette-dot {
            width: 18px;
            height: 18px;
            border-radius: 999px;
            cursor: pointer;
            border: 0;
            display: grid;
            place-items: center;
            font-size: 0;
            user-select: none;
            flex-shrink: 0;
            outline: 2px solid transparent;
            outline-offset: 0;
            transition: transform 180ms var(--ct-spring), outline-color 160ms, outline-offset 260ms var(--ct-spring);
        }
        .custom-palette-dot:hover { transform: scale(1.18); }
        .custom-palette-dot.active {
            outline-color: var(--ct-ink);
            outline-offset: 2px;
        }
        .custom-palette-dot.active::after {
            content: '';
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #fff;
        }

        /* 6. 긴 제목 흐르기 */
        .marquee-target.can-animate:hover {
            text-overflow: clip !important;
            overflow: visible !important;
            display: inline-block !important;
            animation: moveTextDynamic 6s var(--ct-ease) .4s infinite;
            padding-right: 50px;
        }
        @keyframes moveTextDynamic {
            0%, 10% { transform: translateX(0); }
            45%, 60% { transform: translateX(var(--move-dist)); }
            95%, 100% { transform: translateX(0); }
        }

        /* 7. 보관함 높이 조절 핸들 */
        .crack-resizer-handle {
            cursor: ns-resize !important;
            height: 4px !important;
            position: relative;
            background: transparent !important;
            transition: background-color 160ms;
        }
        .crack-resizer-handle::after {
            content: '';
            position: absolute;
            left: 50%;
            top: 50%;
            width: 30px;
            height: 4px;
            margin: -2px 0 0 -15px;
            border-radius: 4px;
            background: var(--ct-ink);
            opacity: 0;
            transform: scaleX(.3);
            transition: opacity 160ms, transform 260ms var(--ct-spring);
            pointer-events: none;
        }
        .crack-resizer-handle:hover { background: var(--ct-line2) !important; }
        .crack-resizer-handle:hover::after { opacity: .8; transform: none; }

        .crack-archive-resized {
            max-height: var(--crack-archive-h, 284px) !important;
            overflow-y: auto !important;
            overflow-y: overlay !important;
            overflow-x: hidden !important;
            overscroll-behavior: contain !important;
            padding-bottom: 4px !important;
            transition: none !important;
            scrollbar-width: thin !important;
            scrollbar-color: transparent transparent !important;
        }
        .crack-archive-resized:hover {
            scrollbar-color: rgba(150, 150, 150, 0.5) transparent !important;
        }
        .crack-archive-resized::-webkit-scrollbar { width: 4px !important; }
        .crack-archive-resized::-webkit-scrollbar-track { background: transparent !important; }
        .crack-archive-resized::-webkit-scrollbar-thumb {
            background: transparent !important;
            border-radius: 4px !important;
        }
        .crack-archive-resized:hover::-webkit-scrollbar-thumb {
            background: rgba(150, 150, 150, 0.5) !important;
        }

        /* 8. 스마트 자동 정리 메뉴 항목 + 반짝이 아이콘 */
        .crack-smart-organize-menu-item {
            display: flex;
            align-items: center;
            gap: 10px;
            min-height: 34px;
            box-sizing: border-box;
            margin: 2px 0;
            padding: 0 10px;
            border-radius: 9px;
            color: inherit;
            font-size: 13px;
            line-height: 1.2;
            cursor: pointer;
            user-select: none;
            outline: none;
            transition: background-color 120ms;
        }
        .crack-smart-organize-menu-item:hover,
        .crack-smart-organize-menu-item:focus-visible { background: var(--ct-hover2); }
        .crack-smart-organize-menu-icon {
            width: 18px;
            flex: 0 0 18px;
            display: grid;
            place-items: center;
            color: var(--ct-text);
        }
        .crack-smart-organize-menu-label { flex: 1; min-width: 0; }
        .crack-smart-organize-menu-badge {
            padding: 2px 7px;
            border-radius: 999px;
            background: var(--ct-ink);
            color: var(--ct-ink-fg);
            font-size: 10px;
            font-weight: 720;
        }
        .crack-spark path { transform-box: fill-box; transform-origin: center; }
        .crack-spark .ct-s1 { transition: transform 480ms var(--ct-spring); }
        .crack-spark .ct-s2,
        .crack-spark .ct-s3 { transform: scale(0); transition: transform 300ms var(--ct-spring); }
        .crack-smart-organize-menu-item:hover .ct-s1,
        .crack-smart-organize-menu-item:focus-visible .ct-s1 { transform: rotate(90deg) scale(.88); }
        .crack-smart-organize-menu-item:hover .ct-s2,
        .crack-smart-organize-menu-item:focus-visible .ct-s2 { transform: scale(1); transition-delay: 70ms; }
        .crack-smart-organize-menu-item:hover .ct-s3,
        .crack-smart-organize-menu-item:focus-visible .ct-s3 { transform: scale(1); transition-delay: 140ms; }
        @keyframes ctSparkSpin {
            0% { transform: rotate(0) scale(1); }
            50% { transform: rotate(90deg) scale(.76); }
            100% { transform: rotate(180deg) scale(1); }
        }
        @keyframes ctTwinkle {
            0%, 100% { transform: scale(.2); opacity: .3; }
            50% { transform: scale(1); opacity: 1; }
        }
        @keyframes ctSparkPop {
            0% { transform: scale(.5) rotate(-60deg); }
            100% { transform: none; }
        }
        @keyframes ctSpin { to { transform: rotate(360deg); } }
    `);

    // 스마트 자동 정리 창 + 한눈에 보기 스타일
    addCrackStyle(`
        /* ── 스마트 자동 정리 창 ── */
        .crack-so {
            position: fixed;
            inset: 0;
            z-index: 2147483000;
            display: flex;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
            padding: 22px;
            background: var(--ct-scrim);
            -webkit-backdrop-filter: blur(4px);
            backdrop-filter: blur(4px);
            color: var(--ct-text);
            font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Segoe UI", sans-serif;
            opacity: 0;
            transition: opacity 180ms;
        }
        .crack-so.is-open { opacity: 1; transition: opacity 220ms; }
        .crack-so.is-closing { pointer-events: none; }
        .crack-so * { box-sizing: border-box; }
        .crack-so-dlg {
            width: min(640px, 100%);
            max-height: min(820px, calc(100vh - 44px));
            display: flex;
            flex-direction: column;
            overflow: hidden;
            border: 1px solid var(--ct-line2);
            border-radius: 22px;
            background: var(--ct-raise);
            box-shadow: var(--ct-shadow-lg);
            outline: none;
            opacity: 0;
            transform: translateY(14px) scale(.965);
            transition: transform 200ms var(--ct-ease), opacity 150ms;
        }
        .crack-so.is-open .crack-so-dlg {
            opacity: 1;
            transform: none;
            transition: transform 420ms var(--ct-soft), opacity 200ms;
        }
        .crack-smart-head {
            display: flex;
            align-items: center;
            gap: 13px;
            padding: 18px 16px 14px 20px;
        }
        .crack-so-mark {
            width: 40px;
            height: 40px;
            flex: 0 0 40px;
            border-radius: 13px;
            display: grid;
            place-items: center;
            background: var(--ct-sunk);
            color: var(--ct-text);
        }
        .crack-so-mark .ct-s2,
        .crack-so-mark .ct-s3,
        .crack-so-orb .ct-s2,
        .crack-so-orb .ct-s3 { transform: scale(1); }
        .crack-so[data-phase="loading"] .crack-so-mark .ct-s1,
        .crack-so[data-phase="preparing"] .crack-so-mark .ct-s1,
        .crack-so[data-phase="applying"] .crack-so-mark .ct-s1,
        .crack-so-orb .ct-s1 { animation: ctSparkSpin 1.8s var(--ct-ease) infinite; }
        .crack-so[data-phase="loading"] .crack-so-mark .ct-s2,
        .crack-so[data-phase="preparing"] .crack-so-mark .ct-s2,
        .crack-so[data-phase="applying"] .crack-so-mark .ct-s2,
        .crack-so-orb .ct-s2 { animation: ctTwinkle 1.8s ease-in-out infinite; }
        .crack-so[data-phase="loading"] .crack-so-mark .ct-s3,
        .crack-so[data-phase="preparing"] .crack-so-mark .ct-s3,
        .crack-so[data-phase="applying"] .crack-so-mark .ct-s3,
        .crack-so-orb .ct-s3 { animation: ctTwinkle 1.8s ease-in-out .6s infinite; }
        .crack-so[data-phase="done"] .crack-so-mark .ct-s1 { animation: ctSparkPop 700ms var(--ct-spring); }
        .crack-smart-title-wrap { min-width: 0; flex: 1; }
        .crack-smart-title {
            margin: 0;
            color: var(--ct-text);
            font-size: 16.5px;
            font-weight: 760;
            letter-spacing: -.02em;
            line-height: 1.3;
        }
        .crack-smart-subtitle {
            margin-top: 3px;
            color: var(--ct-muted);
            font-size: 12px;
            line-height: 1.5;
        }
        .crack-smart-close {
            width: 32px;
            height: 32px;
            padding: 0;
            border: 0;
            border-radius: 9px;
            background: transparent;
            color: var(--ct-muted);
            display: grid;
            place-items: center;
            cursor: pointer;
            transition: background-color 140ms, opacity 140ms;
        }
        .crack-smart-close:hover:not(:disabled) { background: var(--ct-hover2); color: var(--ct-text); }
        .crack-smart-close:disabled { opacity: .3; cursor: default; }
        .crack-so-steps {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            margin: 0;
            padding: 2px 20px 16px;
            list-style: none;
            border-bottom: 1px solid var(--ct-line);
        }
        .crack-so-steps li {
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 7px;
            font-size: 11px;
            color: var(--ct-faint);
            transition: color 240ms;
        }
        .crack-so-steps li::before {
            content: '';
            width: 9px;
            height: 9px;
            border-radius: 50%;
            background: var(--ct-line2);
            position: relative;
            z-index: 1;
            transition: background-color 260ms, transform 360ms var(--ct-spring), box-shadow 260ms;
        }
        .crack-so-ln {
            position: absolute;
            top: 3.5px;
            left: calc(50% + 10px);
            width: calc(100% - 20px);
            height: 2px;
            border-radius: 2px;
            background: var(--ct-line);
            overflow: hidden;
        }
        .crack-so-steps li:last-child .crack-so-ln { display: none; }
        .crack-so-ln::after {
            content: '';
            position: absolute;
            inset: 0;
            background: var(--ct-ink);
            transform: scaleX(0);
            transform-origin: left;
            transition: transform 480ms var(--ct-ease);
        }
        .crack-so-steps li.is-done .crack-so-ln::after { transform: none; }
        .crack-so-steps li.is-done { color: var(--ct-muted); }
        .crack-so-steps li.is-done::before { background: var(--ct-ink); }
        .crack-so-steps li.is-now { color: var(--ct-text); font-weight: 680; }
        .crack-so-steps li.is-now::before {
            background: var(--ct-ink);
            box-shadow: 0 0 0 4px var(--ct-ring);
            transform: scale(1.2);
        }
        .crack-so-steps li.is-err { color: var(--ct-danger); font-weight: 680; }
        .crack-so-steps li.is-err::before {
            background: var(--ct-danger);
            box-shadow: 0 0 0 4px color-mix(in srgb, var(--ct-danger) 22%, transparent);
        }
        .crack-smart-body {
            position: relative;
            flex: 1;
            min-height: 200px;
            overflow-y: auto;
            overscroll-behavior: contain;
            padding: 14px 20px 16px;
            container-type: inline-size;
        }
        .crack-smart-foot {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 14px 16px 16px 20px;
            border-top: 1px solid var(--ct-line);
        }
        .crack-smart-summary {
            margin-right: auto;
            color: var(--ct-muted);
            font-size: 12.5px;
            font-variant-numeric: tabular-nums;
        }
        .crack-smart-summary.is-bump { animation: ctBump 320ms var(--ct-spring); }
        @keyframes ctBump { from { transform: translateY(3px); opacity: .4; } }
        .crack-smart-button {
            min-height: 36px;
            padding: 0 15px;
            border: 1px solid var(--ct-line2);
            border-radius: 10px;
            background: transparent;
            color: var(--ct-text);
            font-size: 12.5px;
            font-weight: 660;
            display: inline-flex;
            align-items: center;
            gap: 7px;
            white-space: nowrap;
            cursor: pointer;
            transition: background-color 150ms, transform 120ms, opacity 150ms;
        }
        .crack-smart-button:hover:not(:disabled) { background: var(--ct-hover); }
        .crack-smart-button:active:not(:disabled) { transform: scale(.97); }
        .crack-smart-button:focus-visible,
        .crack-smart-close:focus-visible { outline: 2px solid var(--ct-ink); outline-offset: 2px; }
        .crack-smart-button.primary {
            border-color: transparent;
            background: var(--ct-ink);
            color: var(--ct-ink-fg);
        }
        .crack-smart-button.primary:hover:not(:disabled) {
            background: color-mix(in srgb, var(--ct-ink) 86%, var(--ct-raise));
        }
        .crack-smart-button.small { min-height: 30px; padding: 0 11px; font-size: 11.5px; border-radius: 8px; }
        .crack-smart-button:disabled { cursor: default; opacity: .42; }
        .crack-so-spin {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            border: 1.5px solid color-mix(in srgb, var(--ct-ink-fg) 35%, transparent);
            border-top-color: var(--ct-ink-fg);
            animation: ctSpin .8s linear infinite;
        }
        .crack-so-pane { animation: ctPaneIn 300ms var(--ct-ease) both; }
        @keyframes ctPaneIn { from { opacity: 0; transform: translateY(8px); } }
        .crack-so-center {
            min-height: 250px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 10px 0;
            color: var(--ct-muted);
            text-align: center;
        }
        .crack-so-center h4 {
            margin: 6px 0 0;
            color: var(--ct-text);
            font-size: 16px;
            font-weight: 740;
            letter-spacing: -.015em;
        }
        .crack-so-center p { margin: 0; font-size: 13px; line-height: 1.7; }
        .crack-so-faint { color: var(--ct-faint); font-size: 12px; }
        .crack-smart-progress-text { font-size: 13px; color: var(--ct-muted); }
        .crack-smart-progress-text { animation: none; }
        @keyframes ctStatusIn { from { opacity: 0; transform: translateY(4px); } }
        .crack-so-orb {
            position: relative;
            width: 70px;
            height: 70px;
            border-radius: 50%;
            display: grid;
            place-items: center;
            color: var(--ct-text);
            background: var(--ct-sunk);
        }
        .crack-so-orb::before {
            content: '';
            position: absolute;
            inset: -5px;
            border-radius: 50%;
            border: 2px solid transparent;
            border-top-color: var(--ct-ink);
            border-right-color: var(--ct-line2);
            animation: ctSpin 1.1s linear infinite;
        }
        .crack-so-bar {
            height: 4px;
            width: 100%;
            border-radius: 4px;
            background: var(--ct-line);
            overflow: hidden;
        }
        .crack-so-center .crack-so-bar { width: min(240px, 80%); }
        .crack-so-bar > i {
            display: block;
            height: 100%;
            width: 0;
            border-radius: inherit;
            background: var(--ct-ink);
            transition: width 420ms var(--ct-ease);
        }
        .crack-so-bar.is-ind > i { width: 34%; animation: ctInd 1.3s var(--ct-ease) infinite; }
        @keyframes ctInd { 0% { transform: translateX(-110%); } 100% { transform: translateX(310%); } }
        .crack-so-tools {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            align-items: center;
            margin: 0 0 12px;
        }
        .crack-so-grow { flex: 1; }
        .crack-smart-chip {
            padding: 4px 9px;
            border-radius: 999px;
            background: var(--ct-sunk);
            color: var(--ct-muted);
            font-size: 11px;
            font-weight: 660;
        }
        .crack-smart-chip.conflict {
            background: transparent;
            color: var(--ct-text);
            box-shadow: inset 0 0 0 1px var(--ct-line2);
        }
        .crack-so-rows { display: flex; flex-direction: column; gap: 6px; }
        .crack-so-row {
            display: grid;
            grid-template-columns: auto minmax(0, 1fr) auto;
            align-items: center;
            column-gap: 12px;
            padding: 10px 10px 10px 12px;
            border: 1px solid var(--ct-line);
            border-radius: 14px;
            background: var(--ct-tint);
            animation: ctRowIn 340ms var(--ct-ease) both;
            animation-delay: calc(60ms + var(--d, 0) * 32ms);
        }
        @keyframes ctRowIn { from { opacity: 0; transform: translateY(6px); } }
        .crack-so-thumb {
            width: 34px;
            height: 34px;
            border-radius: 50%;
            display: grid;
            place-items: center;
            background: var(--ct-sunk);
            color: var(--ct-muted);
            font-size: 13px;
            font-weight: 700;
            transition: opacity 200ms;
        }
        .crack-so-row-main { min-width: 0; transition: opacity 200ms; }
        .crack-so-row[data-action="skip"] .crack-so-row-main,
        .crack-so-row[data-action="skip"] > .crack-so-thumb { opacity: .4; }
        .crack-so-name { display: flex; align-items: center; gap: 6px; min-width: 0; }
        .crack-so-name strong {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: var(--ct-text);
            font-size: 13px;
            font-weight: 660;
        }
        .crack-so-tag {
            flex: 0 0 auto;
            padding: 2px 6px;
            border-radius: 5px;
            background: var(--ct-hover2);
            color: var(--ct-muted);
            font-size: 10px;
            font-weight: 720;
        }
        .crack-so-meta { margin-top: 4px; color: var(--ct-muted); font-size: 11.5px; }
        .crack-so-seg {
            position: relative;
            display: grid;
            grid-template-columns: repeat(var(--n, 2), 1fr);
            padding: 3px;
            border-radius: 10px;
            background: var(--ct-sunk);
            isolation: isolate;
        }
        .crack-so-seg-ind {
            position: absolute;
            z-index: -1;
            top: 3px;
            bottom: 3px;
            left: 3px;
            width: calc((100% - 6px) / var(--n, 2));
            border-radius: 7px;
            background: var(--ct-knob);
            box-shadow: 0 1px 3px rgba(0, 0, 0, .14), 0 0 0 1px var(--ct-line);
            transform: translateX(calc(100% * var(--i, 0)));
            transition: transform 300ms var(--ct-ease);
        }
        .crack-so-seg button {
            padding: 6px 11px;
            border: 0;
            border-radius: 7px;
            background: transparent;
            color: var(--ct-muted);
            font-size: 12px;
            font-weight: 640;
            white-space: nowrap;
            cursor: pointer;
            transition: color 180ms;
        }
        .crack-so-seg button[aria-pressed="true"] { color: var(--ct-text); }
        .crack-so-seg button:focus-visible { outline: 2px solid var(--ct-ink); outline-offset: -2px; }
        .crack-so-target {
            grid-column: 1 / -1;
            display: grid;
            grid-template-rows: 0fr;
            transition: grid-template-rows 300ms var(--ct-ease);
        }
        .crack-so-target > div { overflow: hidden; min-height: 0; }
        .crack-so-row.is-target .crack-so-target { grid-template-rows: 1fr; }
        .crack-so-tg {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px 10px;
            padding: 10px 0 2px 46px;
            color: var(--ct-muted);
            font-size: 11.5px;
        }
        .crack-so-tg em { font-style: normal; color: var(--ct-text); font-weight: 620; }
        .crack-smart-select {
            height: 32px;
            max-width: 100%;
            min-width: 0;
            padding: 0 10px;
            border: 1px solid var(--ct-line2);
            border-radius: 8px;
            outline: none;
            background: var(--ct-sunk);
            color: var(--ct-text);
            font-size: 12px;
        }
        .crack-smart-select:focus-visible { outline: 2px solid var(--ct-ink); outline-offset: 1px; }
        .crack-so-note { margin: 14px 2px 0; color: var(--ct-faint); font-size: 11.5px; line-height: 1.6; }
        @container (max-width: 470px) {
            .crack-so-row { grid-template-columns: auto minmax(0, 1fr); }
            .crack-so-row .crack-so-seg { grid-column: 1 / -1; margin-top: 10px; }
            .crack-so-tg { padding-left: 0; }
        }
        .crack-so-prog-top {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 12px;
            margin: 4px 0 9px;
        }
        .crack-so-prog-top .crack-smart-progress-text {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: var(--ct-text);
        }
        .crack-so-count { font-size: 12px; font-variant-numeric: tabular-nums; }
        .crack-so-apply {
            list-style: none;
            margin: 14px 0 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .crack-so-apply li {
            display: flex;
            align-items: center;
            gap: 11px;
            padding: 9px 10px;
            border-radius: 10px;
            color: var(--ct-faint);
            font-size: 12.5px;
            transition: background-color 220ms, color 220ms;
        }
        .crack-so-apply li.is-now { background: var(--ct-hover); color: var(--ct-text); }
        .crack-so-apply li.is-done { color: var(--ct-text); }
        .crack-so-st {
            position: relative;
            width: 16px;
            height: 16px;
            flex: 0 0 16px;
            border-radius: 50%;
            border: 1.5px solid var(--ct-line2);
            transition: border-color 200ms, background-color 200ms;
        }
        .crack-so-apply li.is-now .crack-so-st { border-top-color: var(--ct-ink); animation: ctSpin .8s linear infinite; }
        .crack-so-apply li.is-done .crack-so-st { border-color: var(--ct-ink); background: var(--ct-ink); }
        .crack-so-apply li.is-done .crack-so-st::after {
            content: '';
            position: absolute;
            left: 4.2px;
            top: 1.6px;
            width: 3.6px;
            height: 7px;
            border: solid var(--ct-ink-fg);
            border-width: 0 1.6px 1.6px 0;
            transform: rotate(45deg) scale(0);
            animation: ctCheckPop 300ms var(--ct-spring) forwards;
        }
        @keyframes ctCheckPop { to { transform: rotate(45deg) scale(1); } }
        .crack-so-ap-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .crack-so-ap-act { color: var(--ct-faint); font-size: 11px; }
        .crack-so-check {
            width: 60px;
            height: 60px;
            fill: none;
            stroke: var(--ct-ink);
            stroke-width: 2.5;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        .crack-so-check circle { stroke-dasharray: 145; stroke-dashoffset: 145; animation: ctDraw 560ms var(--ct-ease) forwards; }
        .crack-so-check path { stroke-dasharray: 32; stroke-dashoffset: 32; animation: ctDraw 380ms var(--ct-ease) 460ms forwards; }
        @keyframes ctDraw { to { stroke-dashoffset: 0; } }
        .crack-so-err {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            display: grid;
            place-items: center;
            color: var(--ct-danger);
            background: color-mix(in srgb, var(--ct-danger) 14%, transparent);
            animation: ctShake 460ms var(--ct-ease) 120ms;
        }
        @keyframes ctShake {
            0%, 100% { transform: none; }
            20% { transform: translateX(-5px); }
            40% { transform: translateX(5px); }
            60% { transform: translateX(-3px); }
            80% { transform: translateX(2px); }
        }
        .crack-smart-error { color: var(--ct-danger); font-size: 12px; line-height: 1.6; white-space: pre-wrap; }
        .crack-smart-result-list { width: min(520px, 100%); margin: 4px 0 0; padding-left: 18px; text-align: left; }
        @media (max-width: 700px) {
            .crack-so { align-items: flex-end; padding: 0; }
            .crack-so-dlg { width: 100%; max-height: 92vh; border-radius: 20px 20px 0 0; transform: translateY(40px); }
            .crack-smart-foot { padding-bottom: max(16px, env(safe-area-inset-bottom, 0px)); }
        }

        /* ── 한눈에 보기 (PC·모바일) ── */
        #crack-lounge {
            position: fixed;
            right: 0;
            bottom: 0;
            z-index: 9995;
            display: grid;
            grid-template-rows: auto auto minmax(0, 1fr);
            box-sizing: border-box;
            background: var(--ct-canvas);
            color: var(--ct-text);
            border-left: 1px solid var(--ct-line);
            container-type: inline-size;
            clip-path: inset(0 calc(100% - var(--crack-lg-from, 260px)) 0 0);
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
            transition: clip-path 380ms var(--ct-ease), opacity 220ms 120ms, visibility 0s 400ms;
        }
        #crack-lounge.is-open {
            clip-path: inset(0 0 0 0);
            opacity: 1;
            visibility: visible;
            pointer-events: auto;
            transition: clip-path 520ms var(--ct-ease), opacity 140ms, visibility 0s;
        }
        #crack-lounge * { box-sizing: border-box; }
        .crack-lg-top {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 10px 12px;
            padding: 12px 16px;
            border-bottom: 1px solid var(--ct-line);
            background: var(--ct-bg);
        }
        .crack-lg-close {
            width: 36px;
            height: 36px;
            flex: 0 0 36px;
            display: grid;
            place-items: center;
            padding: 0;
            border: 0;
            border-radius: 11px;
            background: var(--ct-field);
            color: var(--ct-text);
            cursor: pointer;
            transition: background-color 150ms, transform 120ms;
        }
        .crack-lg-close:hover { background: var(--ct-hover2); }
        .crack-lg-close:active { transform: scale(.94); }
        .crack-lg-heading { display: flex; align-items: baseline; gap: 8px; margin-right: 4px; }
        .crack-lg-heading strong { font-size: 17px; font-weight: 780; letter-spacing: -.025em; }
        .crack-lg-sub { font-style: normal; font-size: 12px; color: var(--ct-faint); font-variant-numeric: tabular-nums; }
        .crack-lg-search {
            flex: 1 1 180px;
            max-width: 320px;
            min-width: 0;
            display: flex;
            align-items: center;
            gap: 8px;
            height: 36px;
            padding: 0 6px 0 11px;
            border-radius: 11px;
            background: var(--ct-field);
            transition: background-color 180ms, box-shadow 180ms var(--ct-ease);
        }
        .crack-lg-search:focus-within { background: var(--ct-raise); box-shadow: 0 0 0 1px var(--ct-line2), 0 0 0 4px var(--ct-ring); }
        .crack-lg-search > svg { color: var(--ct-faint); flex: 0 0 auto; }
        .crack-lg-search input {
            flex: 1;
            min-width: 0;
            border: 0;
            outline: 0;
            background: transparent;
            color: var(--ct-text);
            font-size: 13px;
        }
        .crack-lg-search input::placeholder { color: var(--ct-faint); }
        .crack-lg-clear {
            width: 24px;
            height: 24px;
            flex: 0 0 24px;
            display: grid;
            place-items: center;
            padding: 0;
            border: 0;
            border-radius: 7px;
            background: transparent;
            color: var(--ct-muted);
            cursor: pointer;
            opacity: 0;
            pointer-events: none;
            transform: scale(.6);
            transition: opacity 140ms, transform 220ms var(--ct-spring), background-color 140ms;
        }
        .crack-lg-clear.is-on { opacity: 1; pointer-events: auto; transform: none; }
        .crack-lg-clear:hover { background: var(--ct-hover2); color: var(--ct-text); }
        .crack-lg-colors {
            display: flex;
            align-items: center;
            gap: 9px;
            padding: 3px 10px 3px 3px;
            border-radius: 999px;
            background: var(--ct-sunk);
        }
        .crack-lg-cf {
            width: 16px;
            height: 16px;
            padding: 0;
            border: 0;
            border-radius: 50%;
            background: var(--d);
            cursor: pointer;
            outline: 2px solid transparent;
            outline-offset: 0;
            transition: outline-color 160ms, outline-offset 260ms var(--ct-spring), transform 200ms var(--ct-spring);
        }
        .crack-lg-cf:hover { transform: scale(1.15); }
        .crack-lg-cf.is-on { outline-color: var(--d); outline-offset: 2px; }
        .crack-lg-cf.is-all {
            width: auto;
            height: 26px;
            padding: 0 11px;
            border-radius: 999px;
            background: transparent;
            color: var(--ct-muted);
            font-size: 11.5px;
            font-weight: 680;
            outline: 0;
            transform: none;
        }
        .crack-lg-cf.is-all.is-on { background: var(--ct-knob); color: var(--ct-text); box-shadow: 0 0 0 1px var(--ct-line); }
        .crack-lg-seg {
            position: relative;
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            padding: 3px;
            border-radius: 10px;
            background: var(--ct-sunk);
            isolation: isolate;
        }
        .crack-lg-seg > i {
            position: absolute;
            z-index: -1;
            top: 3px;
            bottom: 3px;
            left: 3px;
            width: calc((100% - 6px) / 2);
            border-radius: 7px;
            background: var(--ct-knob);
            box-shadow: 0 1px 3px rgba(0, 0, 0, .14), 0 0 0 1px var(--ct-line);
            transform: translateX(calc(100% * var(--i, 0)));
            transition: transform 300ms var(--ct-ease);
        }
        .crack-lg-seg button {
            padding: 6px 11px;
            border: 0;
            border-radius: 7px;
            background: transparent;
            color: var(--ct-muted);
            font-size: 12px;
            font-weight: 640;
            white-space: nowrap;
            cursor: pointer;
            transition: color 180ms;
        }
        .crack-lg-seg button[aria-pressed="true"] { color: var(--ct-text); }
        .crack-lg-view-tools { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; flex: 0 1 auto; gap: 6px; }
        #crack-lounge.is-by-color .crack-lg-colors { display: none; }
        .crack-lg-rail-dot { width: 10px; height: 10px; margin: 0 2px; border-radius: 50%; background: var(--d); }
        .crack-lg-rail-dot.is-none { background: transparent; box-shadow: inset 0 0 0 1.5px var(--ct-faint); }
        .crack-lg-rail-btn.is-drop { background: var(--ct-current); color: var(--ct-text); box-shadow: inset 0 0 0 1.5px var(--ct-ink); }
        .crack-lg-color-group .crack-lg-gh { align-items: center; }
        .crack-lg-gh-dot { width: 10px; height: 10px; flex: 0 0 10px; border-radius: 50%; background: var(--folder-color); }
        .crack-lg-gh-dot.is-none { background: transparent; box-shadow: inset 0 0 0 1.5px var(--ct-faint); }
        .crack-lg-gh-edit { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 7px; background: transparent; color: var(--ct-faint); cursor: pointer; opacity: .7; transition: opacity 140ms, background-color 140ms, color 140ms; }
        .crack-lg-gh-edit:hover, .crack-lg-gh-edit:focus-visible { opacity: 1; background: var(--ct-hover2); color: var(--ct-text); }
        .crack-lg-gh-input { width: 140px; height: 26px; padding: 0 8px; border: 1px solid var(--ct-line2); border-radius: 7px; outline: 0; background: var(--ct-field); color: var(--ct-text); font: inherit; font-size: 13px; font-weight: 700; }
        .crack-lg-gh-input:focus { box-shadow: 0 0 0 3px var(--ct-ring); }
        .crack-lg-tile[draggable="true"] { -webkit-user-drag: element; }
        .crack-lg-tile.is-dragging { opacity: .45; }
        .crack-lg-quick-actions { display: flex; align-items: center; gap: 4px; padding: 3px; border-radius: 10px; background: var(--ct-sunk); }
        .crack-lg-quick-actions button { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 7px; background: transparent; color: var(--ct-muted); cursor: pointer; transition: background 150ms, color 150ms, transform 120ms; }
        .crack-lg-quick-actions button:hover { background: var(--ct-hover2); color: var(--ct-text); }
        .crack-lg-quick-actions button:active { transform: scale(.94); }
        .crack-lg-quick-actions button.is-on { background: var(--ct-knob); color: var(--ct-text); box-shadow: 0 1px 3px rgba(0,0,0,.14), 0 0 0 1px var(--ct-line); }
        /* 1.4.1: 색 거르기 펼치기 · 색 추가 · 버튼 움직임 */
        .crack-lg-colors { gap: 0; padding: 3px; }
        .crack-lg-cf.is-all { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; }
        .crack-lg-cf.is-all.has-color { padding: 0 11px 0 9px; color: var(--ct-text); }
        .crack-lg-cf-dot { width: 10px; height: 10px; flex: 0 0 10px; border-radius: 50%; background: var(--d); }
        .crack-lg-cf-list { display: flex; align-items: center; gap: 9px; max-width: 0; padding: 0; overflow: hidden; opacity: 0; transition: max-width 320ms var(--ct-ease), padding 320ms var(--ct-ease), opacity 180ms; }
        .crack-lg-colors.is-open .crack-lg-cf-list { max-width: calc(var(--cf-w, 240px) + 17px); padding: 4px 8px 4px 9px; opacity: 1; }
        .crack-lg-cf-list > button { flex: 0 0 auto; opacity: 0; transform: scale(.3); transition: transform 260ms var(--ct-spring), opacity 140ms, outline-color 160ms, outline-offset 260ms var(--ct-spring); }
        .crack-lg-colors.is-open .crack-lg-cf-list > button { opacity: 1; transform: none; transition-delay: calc(60ms + var(--n, 0) * 30ms), calc(60ms + var(--n, 0) * 30ms), 0ms, 0ms; }
        .crack-lg-colors.is-open .crack-lg-cf-list > button:hover { transform: scale(1.15); transition-delay: 0ms; }
        .crack-lg-cf-add, .crack-lg-pop-add { display: grid; place-items: center; width: 18px; height: 18px; padding: 0; border: 1px dashed var(--ct-line2); border-radius: 50%; background: transparent; color: var(--ct-muted); cursor: pointer; }
        .crack-lg-cf-add:hover, .crack-lg-pop-add:hover { border-style: solid; color: var(--ct-text); }
        .custom-palette-dot.custom-palette-add { border: 1px dashed var(--ct-line2); background: transparent; color: var(--ct-muted); }
        .custom-palette-dot.custom-palette-add:hover { border-style: solid; color: var(--ct-text); }
        .crack-lg-rail-btn.crack-lg-rail-add { color: var(--ct-faint); }
        .crack-lg-rail-btn.crack-lg-rail-add:hover { color: var(--ct-text); }
        .crack-lg-gh-del.is-armed { opacity: 1; background: var(--ct-hover2); color: #e5534b; }
        .crack-lg-gh-empty { padding: 2px 2px 10px; color: var(--ct-faint); font-size: 12px; }
        .crack-lg-quick-actions button svg, .crack-lg-close svg, .crack-lg-clear svg, .crack-folder-manage-close svg,
        .crack-lg-cf-add svg, .crack-lg-pop-add svg, .crack-lg-rail-add svg, .custom-palette-add svg { transition: transform 360ms var(--ct-spring); }
        .crack-lg-quick-actions [data-folder-tool="create"]:hover svg, .crack-lg-cf-add:hover svg, .crack-lg-pop-add:hover svg,
        .crack-lg-rail-add:hover svg, .custom-palette-add:hover svg { transform: rotate(90deg); }
        .crack-lg-quick-actions [data-folder-tool="create"]:active svg { transform: rotate(90deg) scale(.86); }
        .crack-lg-quick-actions [data-folder-tool="manage"]:hover svg { transform: rotate(90deg); }
        .crack-lg-quick-actions [data-folder-tool="manage"]:active svg { transform: rotate(150deg) scale(.9); }
        .crack-lg-clear:hover svg, .crack-folder-manage-close:hover svg { transform: rotate(90deg); }
        .crack-lg-close:hover svg { transform: translateX(-2px); }
        .crack-lg-select-btn svg path { stroke-dasharray: 16; stroke-dashoffset: 0; }
        .crack-lg-select-btn.is-on svg path { animation: ctCheckDraw 380ms var(--ct-ease) both; }
        @keyframes ctCheckDraw { from { stroke-dashoffset: 16; } }
        .crack-lg-body { display: grid; grid-template-columns: 196px minmax(0, 1fr); min-height: 0; }
        .crack-lg-rail {
            padding: 12px 8px;
            overflow-y: auto;
            border-right: 1px solid var(--ct-line);
            background: var(--ct-bg);
            scrollbar-width: thin;
        }
        .crack-lg-rail-btn {
            display: flex;
            align-items: center;
            gap: 9px;
            width: 100%;
            height: 34px;
            padding: 0 10px;
            border: 0;
            border-radius: 9px;
            background: transparent;
            color: var(--ct-muted);
            font-size: 12.5px;
            font-weight: 620;
            text-align: left;
            cursor: pointer;
            transition: background-color 160ms, color 160ms;
        }
        .crack-lg-rail-btn:hover { background: var(--ct-hover); color: var(--ct-text); }
        .crack-lg-rail-btn.is-on { background: var(--ct-current); color: var(--ct-text); }
        .crack-lg-rail-ic { display: grid; place-items: center; color: var(--ct-faint); transition: color 160ms; }
        .crack-lg-rail-btn.is-on .crack-lg-rail-ic { color: var(--ct-text); }
        .crack-lg-rail-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-style: normal; }
        .crack-lg-rail-count { color: var(--ct-faint); font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
        .crack-lg-rail-h { margin: 16px 10px 6px; color: var(--ct-faint); font-size: 11px; font-weight: 600; }
        .crack-lg-scroll { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 16px 18px 56px; }
        .crack-lg-status {
            display: none;
            align-items: center;
            gap: 8px;
            margin: 0 2px 14px;
            color: var(--ct-faint);
            font-size: 11.5px;
        }
        .crack-lg-status.is-on { display: flex; }
        .crack-lg-status.is-busy::before {
            content: '';
            width: 10px;
            height: 10px;
            border-radius: 50%;
            border: 1.5px solid var(--ct-line2);
            border-top-color: var(--ct-ink);
            animation: ctSpin .8s linear infinite;
        }
        .crack-lg-group { content-visibility: auto; contain-intrinsic-size: auto 420px; }
        .crack-lg-gh {
            display: flex;
            align-items: baseline;
            gap: 8px;
            margin: 22px 2px 10px;
            font-size: 13px;
            letter-spacing: -.01em;
        }
        .crack-lg-group:first-child .crack-lg-gh { margin-top: 0; }
        .crack-lg-gh strong { font-weight: 740; }
        .crack-lg-gh em { font-style: normal; color: var(--ct-faint); font-weight: 600; font-size: 11.5px; font-variant-numeric: tabular-nums; }
        .crack-lg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
        .crack-lg-tile {
            position: relative;
            display: flex;
            gap: 11px;
            align-items: center;
            min-width: 0;
            padding: 10px 10px 10px 11px;
            border: 1px solid var(--ct-line);
            border-radius: 13px;
            background: var(--ct-raise);
            cursor: pointer;
            outline: none;
            transition: background-color 180ms, border-color 180ms, transform 240ms var(--ct-ease), box-shadow 240ms var(--ct-ease);
        }
        .crack-lg-tile:hover,
        .crack-lg-tile.is-menu { border-color: var(--ct-line2); transform: translateY(-2px); box-shadow: var(--ct-lift); }
        .crack-lg-tile:active { transform: translateY(0) scale(.99); }
        .crack-lg-tile:focus-visible { box-shadow: 0 0 0 2px var(--ct-ink); }
        .crack-lg-tile[data-color] { background: color-mix(in srgb, var(--cbg) 42%, var(--ct-raise)); }
        .crack-lg-tile.is-current { border-color: var(--ct-ink); box-shadow: 0 0 0 1px var(--ct-ink); }
        .crack-lg-thumb {
            width: 38px;
            height: 38px;
            flex: 0 0 38px;
            border-radius: 50%;
            display: grid;
            place-items: center;
            overflow: hidden;
            background: var(--ct-sunk);
            color: var(--ct-muted);
            font-size: 13px;
            font-weight: 700;
            outline: 2px solid transparent;
            outline-offset: 0;
            transition: outline-color 220ms, outline-offset 320ms var(--ct-spring);
        }
        .crack-lg-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .crack-lg-tile[data-color] .crack-lg-thumb { outline-color: var(--c); outline-offset: 2px; }
        .crack-lg-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
        .crack-lg-title {
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            font-size: 13px;
            font-weight: 620;
            letter-spacing: -.01em;
        }
        .crack-lg-tile.is-current .crack-lg-title { font-weight: 760; }
        .crack-lg-pv {
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            color: var(--ct-muted);
            font-size: 11.5px;
        }
        .crack-lg-date {
            align-self: flex-start;
            margin-top: 1px;
            color: var(--ct-faint);
            font-size: 10.5px;
            white-space: nowrap;
            transition: opacity 140ms;
        }
        .crack-lg-tile:hover .crack-lg-date,
        .crack-lg-tile.is-menu .crack-lg-date,
        .crack-lg-tile:focus-within .crack-lg-date { opacity: 0; }
        .crack-lg-more {
            position: absolute;
            top: 7px;
            right: 6px;
            width: 24px;
            height: 24px;
            display: grid;
            place-items: center;
            padding: 0;
            border: 0;
            border-radius: 7px;
            background: transparent;
            color: var(--ct-muted);
            cursor: pointer;
            opacity: 0;
            transition: opacity 140ms, background-color 140ms, color 140ms;
        }
        .crack-lg-tile:hover .crack-lg-more,
        .crack-lg-tile:focus-within .crack-lg-more,
        .crack-lg-more[aria-expanded="true"] { opacity: 1; }
        .crack-lg-more:hover,
        .crack-lg-more[aria-expanded="true"] { background: var(--ct-hover2); color: var(--ct-text); }
        #crack-lounge.is-dense .crack-lg-grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 2px 10px; }
        #crack-lounge.is-dense .crack-lg-tile {
            padding: 5px 8px;
            border-color: transparent;
            border-radius: 9px;
            background: transparent;
            transform: none;
            box-shadow: none;
        }
        #crack-lounge.is-dense .crack-lg-tile:hover,
        #crack-lounge.is-dense .crack-lg-tile.is-menu { background: var(--ct-hover); transform: none; box-shadow: none; }
        #crack-lounge.is-dense .crack-lg-tile[data-color] { background: color-mix(in srgb, var(--cbg) 38%, transparent); }
        #crack-lounge.is-dense .crack-lg-tile.is-current { background: var(--ct-current); box-shadow: inset 0 0 0 1px var(--ct-line2); }
        #crack-lounge.is-dense .crack-lg-thumb { width: 26px; height: 26px; flex-basis: 26px; font-size: 11px; }
        #crack-lounge.is-dense .crack-lg-tile[data-color] .crack-lg-thumb { outline-offset: 1.5px; }
        #crack-lounge.is-dense .crack-lg-pv { display: none; }
        #crack-lounge.is-dense .crack-lg-date { align-self: center; margin: 0; }
        #crack-lounge.is-dense .crack-lg-more { top: 50%; margin-top: -12px; }
        .crack-lg-groups.is-enter .crack-lg-tile {
            animation: ctTileIn 380ms var(--ct-ease) both;
            animation-delay: calc(160ms + var(--i, 0) * 12ms);
        }
        .crack-lg-groups.is-enter .crack-lg-gh { animation: ctFadeIn 300ms var(--ct-ease) 120ms both; }
        .crack-lg-groups.is-swap { animation: ctSwapIn 220ms var(--ct-ease); }
        @keyframes ctTileIn { from { opacity: 0; transform: translateY(10px) scale(.97); } }
        @keyframes ctFadeIn { from { opacity: 0; } }
        @keyframes ctSwapIn { from { opacity: 0; transform: translateY(4px); } }
        .crack-lg-more-btn {
            display: block;
            margin: 10px auto 0;
            padding: 7px 14px;
            border: 1px solid var(--ct-line2);
            border-radius: 999px;
            background: transparent;
            color: var(--ct-muted);
            font-size: 12px;
            font-weight: 640;
            cursor: pointer;
            transition: background-color 150ms, color 150ms;
        }
        .crack-lg-more-btn:hover { background: var(--ct-hover); color: var(--ct-text); }
        .crack-lg-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            padding: 60px 20px;
            color: var(--ct-muted);
            font-size: 13px;
            line-height: 1.7;
            text-align: center;
        }
        .crack-lg-pop {
            position: absolute;
            z-index: 5;
            display: flex;
            flex-direction: column;
            align-items: stretch;
            gap: 6px;
            padding: 8px;
            border: 1px solid var(--ct-line2);
            border-radius: 12px;
            background: var(--ct-menu);
            box-shadow: var(--ct-shadow);
            transform-origin: top right;
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
            transform: scale(.94) translateY(-4px);
            transition: opacity 130ms var(--ct-ease), transform 150ms var(--ct-ease), visibility 0s 150ms;
        }
        .crack-lg-pop[data-side="top"] { transform-origin: bottom right; transform: scale(.94) translateY(4px); }
        .crack-lg-pop.is-open {
            opacity: 1;
            visibility: visible;
            pointer-events: auto;
            transform: none;
            transition: opacity 170ms var(--ct-ease), transform 260ms var(--ct-soft), visibility 0s;
        }
        .crack-lg-pop-row { display: flex; align-items: center; gap: 9px; padding: 0 2px; }
        .crack-lg-pop-label { margin-right: 4px; color: var(--ct-faint); font-size: 11.5px; }
        .crack-lg-pop-folder { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 0 8px; border: 0; border-radius: 8px; background: transparent; color: var(--ct-text); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
        .crack-lg-pop-folder:hover, .crack-lg-pop-folder:focus-visible { background: var(--ct-hover2); outline: none; }
        .crack-lg-pop-folder > span { display: grid; place-items: center; color: var(--folder-color, var(--ct-muted)); }
        .crack-lg-pop-folder b { flex: 1; font-weight: 640; }
        .crack-lg-pop-folder em { max-width: 110px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-style: normal; color: var(--ct-faint); font-size: 11.5px; }
        .crack-lg-pop-sep { height: 1px; background: var(--ct-line); }
        .crack-lg-pop-dot {
            width: 18px;
            height: 18px;
            padding: 0;
            border: 0;
            border-radius: 50%;
            background: var(--d);
            display: grid;
            place-items: center;
            cursor: pointer;
            outline: 2px solid transparent;
            outline-offset: 0;
            transition: transform 180ms var(--ct-spring), outline-color 160ms, outline-offset 260ms var(--ct-spring);
        }
        .crack-lg-pop-dot:hover { transform: scale(1.18); }
        .crack-lg-pop-dot.is-on { outline-color: var(--d); outline-offset: 2px; }
        .crack-lg-pop-dot.is-on::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #fff; }
        /* 로컬 폴더는 튜너의 색상 토큰을 그대로 사용한다. */
        #crack-local-folders { padding: 6px 16px 0; border-bottom: 1px solid var(--ct-line); color: var(--ct-text); background: var(--ct-bg); }
        #crack-local-folders[hidden] { display: none !important; }
        .crack-folder-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; width: 100%; }
        .crack-folder-tab, .crack-folder-toggle, .crack-lg-folder-tools button, .crack-lg-pick {
            border: 1px solid var(--ct-line); border-radius: 8px; background: var(--ct-raise);
            color: var(--ct-text); cursor: pointer; font: inherit; transition: background 150ms, border-color 150ms;
        }
        .crack-folder-tab { display: flex; align-items: center; min-width: 0; height: 40px; padding: 0 8px; font-size: 13px; font-weight: 600; white-space: nowrap; }
        .crack-folder-tab { gap: 6px; text-align: left; }
        .crack-folder-tab-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .crack-folder-tab.is-on { background: color-mix(in srgb, var(--folder-color) 12%, var(--ct-raise)); border-color: var(--folder-color); color: var(--ct-text); }
        .crack-folder-tab-icon { display: grid; place-items: center; width: 20px; height: 20px; flex: 0 0 20px; color: var(--folder-color); }
        .crack-folder-tab-icon svg { width: 18px; height: 18px; }
        .crack-folder-tab:hover, .crack-lg-folder-tools button:hover, .crack-lg-pick:hover { background: var(--ct-hover2); border-color: var(--ct-line2); }
        .crack-folder-tab.is-on:hover { background: color-mix(in srgb, var(--folder-color, #2563eb) 18%, var(--ct-raise)); border-color: var(--folder-color, #2563eb); }
        .crack-folder-tab:active, .crack-lg-folder-tools button:active { transform: scale(.98); }
        .crack-lg-folder-tools button:disabled { opacity: .45; cursor: default; }
        .crack-folder-tab:focus-visible, .crack-folder-toggle:focus-visible, .crack-lg-folder-tools button:focus-visible, .crack-lg-quick-actions button:focus-visible, .crack-lg-pick:focus-visible { outline: 2px solid var(--ct-ink); outline-offset: 2px; }
        .crack-folder-toggle { display: flex; align-items: center; gap: 6px; width: calc(100% + 12px); height: 28px; padding: 0 6px; margin: 0 -6px 4px; border: 0; border-radius: 7px; background: transparent; color: var(--ct-faint); font-size: 12px; font-weight: 640; line-height: 1; text-align: left; }
        .crack-folder-toggle:hover { background: var(--ct-hover2); color: var(--ct-muted); }
        .crack-folder-toggle-count { font-weight: 500; font-variant-numeric: tabular-nums; }
        .crack-folder-toggle-chev { display: grid; place-items: center; margin-left: auto; }
        .crack-folder-toggle[aria-expanded="false"] .crack-folder-toggle-chev { transform: rotate(180deg); }
        .crack-folder-toggle.is-opening .crack-folder-toggle-chev { animation: ctChevOpen 260ms var(--ct-ease); }
        .crack-folder-toggle.is-closing .crack-folder-toggle-chev { animation: ctChevClose 260ms var(--ct-ease); }
        @keyframes ctChevOpen { from { transform: rotate(180deg); } to { transform: rotate(0deg); } }
        @keyframes ctChevClose { from { transform: rotate(0deg); } to { transform: rotate(180deg); } }
        .crack-folder-tabs.is-opening { animation: ctFolderTabsIn 240ms var(--ct-ease); }
        @keyframes ctFolderTabsIn { from { opacity: 0; transform: translateY(-4px); } }
        @media (prefers-reduced-motion: reduce) {
            .crack-folder-toggle-chev, .crack-folder-tabs, .custom-palette-add svg, .crack-folder-manage-close svg { animation: none !important; transition: none !important; }
        }
        .crack-folder-tabs { padding-bottom: 8px; }
        .crack-folder-tabs[hidden] { display: none; }
        #crack-folder-results { padding: 10px; background: var(--ct-bg); color: var(--ct-text); }
        #crack-folder-results[hidden] { display: none !important; }
        .crack-folder-card { display: flex; align-items: center; height: 56px; padding: 8px; margin: 0 0 6px; border: 1px solid var(--ct-line); border-radius: 12px; color: var(--ct-text); text-decoration: none; background: var(--ct-raise); overflow: hidden; }
        .crack-folder-card:hover { border-color: var(--ct-line2); }
        .crack-folder-card-border { width: 4px; height: 100%; margin-right: 8px; border-radius: 2px; flex: 0 0 4px; background: var(--folder-color); }
        .crack-folder-card-thumb { display: grid; place-items: center; width: 36px; height: 36px; flex: 0 0 36px; margin-right: 10px; border: 1px solid var(--ct-line); border-radius: 50%; overflow: hidden; background: var(--ct-field); color: var(--ct-muted); }
        .crack-folder-card-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .crack-folder-card-content { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 5px; }
        .crack-folder-card-title, .crack-folder-card-desc { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .crack-folder-card-title { font-size: 13px; font-weight: 620; letter-spacing: -.01em; }
        .crack-folder-card-desc { color: var(--ct-muted); font-size: 11.5px; }
        .crack-folder-empty { padding: 16px 8px; color: var(--ct-muted); font-size: 12.5px; line-height: 1.6; }
        /* 폴더 선택 창: 사이드바 우클릭 메뉴, 한눈에 보기 ··· 메뉴, 선택 도구가 함께 쓴다. */
        #crack-local-assign { position: fixed; z-index: 10001; display: flex; flex-direction: column; width: min(260px, calc(100vw - 16px)); max-height: min(70vh, 460px); padding: 6px; box-sizing: border-box; border: 1px solid var(--ct-line2); border-radius: 14px; background: var(--ct-menu); color: var(--ct-text); box-shadow: var(--ct-shadow); font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Segoe UI", sans-serif; transform-origin: top left; animation: ctAssignIn 180ms var(--ct-soft); }
        #crack-local-assign * { box-sizing: border-box; }
        @keyframes ctAssignIn { from { opacity: 0; transform: scale(.96) translateY(-3px); } }
        .crack-la-head { display: flex; align-items: baseline; gap: 8px; padding: 6px 8px 8px; }
        .crack-la-head strong { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12.5px; font-weight: 720; }
        .crack-la-head em { flex: 0 0 auto; font-style: normal; color: var(--ct-faint); font-size: 11px; font-variant-numeric: tabular-nums; }
        .crack-la-list { min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
        #crack-local-assign button { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 34px; padding: 0 10px; border: 0; border-radius: 9px; background: transparent; color: inherit; text-align: left; font: inherit; font-size: 13px; cursor: pointer; transition: background-color 120ms; }
        #crack-local-assign button:hover, #crack-local-assign button:focus-visible { background: var(--ct-hover2); outline: none; }
        .crack-la-ic { display: grid; place-items: center; width: 18px; flex: 0 0 18px; color: var(--folder-color, var(--ct-muted)); }
        .crack-la-name { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .crack-la-check { flex: 0 0 auto; color: var(--ct-text); font-size: 12px; font-weight: 760; }
        .crack-la-check.is-part { color: var(--ct-faint); }
        #crack-local-assign button.is-current { font-weight: 700; }
        #crack-local-assign .crack-la-muted { color: var(--ct-muted); }
        #crack-local-assign .crack-la-muted .crack-la-ic { color: var(--ct-faint); }
        .crack-la-sep { height: 1px; margin: 5px 4px; background: var(--ct-line); flex: 0 0 auto; }
        .crack-la-empty { padding: 4px 10px 8px; color: var(--ct-muted); font-size: 12px; line-height: 1.5; }
        .crack-la-new { display: flex; gap: 6px; padding: 2px; }
        .crack-la-new input { flex: 1; min-width: 0; height: 34px; padding: 0 10px; border: 1px solid var(--ct-line2); border-radius: 9px; outline: 0; background: var(--ct-field); color: var(--ct-text); font: inherit; font-size: 13px; }
        .crack-la-new input:focus { background: var(--ct-raise); box-shadow: 0 0 0 3px var(--ct-ring); }
        #crack-local-assign .crack-la-new .crack-la-make { width: auto; flex: 0 0 auto; justify-content: center; padding: 0 12px; background: var(--ct-ink); color: var(--ct-ink-fg); font-size: 12px; font-weight: 700; }
        #crack-local-assign .crack-la-new .crack-la-make:hover:not(:disabled) { background: color-mix(in srgb, var(--ct-ink) 86%, var(--ct-raise)); }
        #crack-local-assign .crack-la-new .crack-la-make:disabled { opacity: .42; cursor: default; }
        @media (pointer: coarse) { #crack-local-assign button, .crack-la-new input { min-height: 44px; } }
        /* 사이드바 우클릭 메뉴에 넣는 폴더 항목 */
        .crack-menu-sep { height: 1px; margin: 6px 0 4px; background: var(--ct-line); }
        .crack-folder-menu-item .crack-smart-organize-menu-icon { color: var(--folder-color, var(--ct-text)); }
        .crack-folder-menu-current { max-width: 96px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--ct-faint); font-size: 11.5px; }
        .crack-folder-menu-item + .custom-palette-container { margin-top: 4px; }
        /* 사이드바 색상 모아보기 + 새 폴더 */
        .crack-folder-tab.is-add { justify-content: center; border-style: dashed; color: var(--ct-muted); font-weight: 600; }
        .crack-folder-tab.is-add .crack-folder-tab-icon { color: var(--ct-faint); }
        .crack-folder-tab.is-drop, .crack-folder-color.is-drop { border-color: var(--ct-ink); background: var(--ct-current); }
        .crack-folder-colors { grid-column: 1 / -1; display: flex; align-items: center; gap: 4px; min-width: 0; padding: 2px 0 0; }
        .crack-folder-colors-label { margin-right: auto; color: var(--ct-faint); font-size: 11.5px; font-weight: 600; }
        .crack-folder-color { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 1px solid transparent; border-radius: 8px; background: transparent; cursor: pointer; transition: background-color 140ms, border-color 140ms; }
        .crack-folder-color::before { content: ''; width: 14px; height: 14px; border-radius: 50%; background: var(--d); outline: 2px solid transparent; outline-offset: 0; transition: outline-color 160ms, outline-offset 260ms var(--ct-spring); }
        .crack-folder-color:hover { background: var(--ct-hover2); }
        .crack-folder-color.is-on::before { outline-color: var(--d); outline-offset: 2px; }
        .crack-folder-color:focus-visible { outline: 2px solid var(--ct-ink); outline-offset: 1px; }
        @media (pointer: coarse) { .crack-folder-color { width: 40px; height: 40px; } }
        #crack-tuner-toast { position: fixed; left: 50%; bottom: max(24px, env(safe-area-inset-bottom, 0px)); z-index: 2147483001; max-width: calc(100vw - 32px); padding: 10px 16px; box-sizing: border-box; border-radius: 12px; background: var(--ct-ink); color: var(--ct-ink-fg); font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Segoe UI", sans-serif; font-size: 13px; font-weight: 640; box-shadow: var(--ct-shadow); pointer-events: none; opacity: 0; transform: translate(-50%, 8px); transition: opacity 160ms, transform 220ms var(--ct-ease); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        #crack-tuner-toast.is-on { opacity: 1; transform: translate(-50%, 0); }
        .crack-folder-filtering a[href*="/stories/"]:not(.crack-folder-card),
        .crack-folder-filtering a[href*="/characters/"]:not(.crack-folder-card) { display: none !important; }
        .crack-lg-folder-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--ct-line); background: var(--ct-bg); font-size: .875rem; }
        #crack-lounge:not(.is-selecting) .crack-lg-folder-tools { display: none; }
        .crack-lg-folder-tools button { min-height: 32px; padding: 4px 8px; }
        .crack-lg-folder-tools button.is-on { background: var(--ct-current); font-weight: 700; }
        .crack-lg-folder-tools select { min-height: 32px; max-width: 160px; padding: 4px 8px; border: 1px solid var(--ct-line); border-radius: 8px; background: var(--ct-field); color: var(--ct-text); font: inherit; }
        .crack-lg-pick { display: none; flex: 0 0 28px; width: 28px; height: 28px; padding: 0; font-weight: 700; }
        #crack-lounge.is-selecting .crack-lg-pick { display: grid; place-items: center; }
        #crack-lounge.is-selecting .crack-lg-tile.is-picked { border-color: var(--ct-ink); background: var(--ct-current); }
        #crack-lounge.is-selecting .crack-lg-tile { cursor: default; }
        #crack-lounge.is-selecting .crack-lg-more { display: none; }
        .crack-lg-local-folder .crack-lg-gh strong { color: var(--folder-color); }
        .crack-folder-manage { position: fixed; inset: 0; z-index: 10002; display: grid; place-items: center; padding: 16px; background: var(--ct-scrim); color: var(--ct-text); font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Segoe UI", sans-serif; -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); opacity: 0; transition: opacity 180ms; }
        .crack-folder-manage.is-open { opacity: 1; }
        .crack-folder-manage * { box-sizing: border-box; }
        .crack-folder-manage-panel { display: flex; flex-direction: column; width: min(620px, 100%); max-height: min(760px, calc(100dvh - 32px)); overflow: hidden; border: 1px solid var(--ct-line2); border-radius: 22px; background: var(--ct-raise); box-shadow: var(--ct-shadow-lg); opacity: 0; transform: translateY(14px) scale(.965); transition: transform 200ms var(--ct-ease), opacity 150ms; }
        .crack-folder-manage.is-open .crack-folder-manage-panel { opacity: 1; transform: none; transition: transform 420ms var(--ct-soft), opacity 200ms; }
        .crack-folder-manage-head { display: flex; align-items: center; gap: 13px; padding: 18px 16px 14px 20px; border-bottom: 1px solid var(--ct-line); }
        .crack-folder-manage-mark { display: grid; place-items: center; width: 40px; height: 40px; flex: 0 0 40px; border-radius: 13px; background: var(--ct-sunk); color: var(--ct-text); }
        .crack-folder-manage-mark svg { width: 21px; height: 21px; }
        .crack-folder-manage-heading { flex: 1; min-width: 0; }
        .crack-folder-manage-heading h2 { margin: 0; font-size: 16.5px; font-weight: 760; line-height: 1.3; letter-spacing: -.02em; }
        .crack-folder-manage-heading p { margin: 3px 0 0; color: var(--ct-muted); font-size: 12px; line-height: 1.5; }
        .crack-folder-manage-close { display: grid; place-items: center; width: 32px; height: 32px; flex: 0 0 32px; padding: 0; border: 0; border-radius: 9px; background: transparent; color: var(--ct-muted); cursor: pointer; }
        .crack-folder-manage-close:hover { background: var(--ct-hover2); color: var(--ct-text); }
        .crack-folder-create-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding: 16px 20px; border-bottom: 1px solid var(--ct-line); }
        .crack-folder-create-form label { grid-column: 1 / -1; color: var(--ct-muted); font-size: 12px; font-weight: 680; }
        .crack-folder-create-form input, .crack-folder-inspector input { width: 100%; min-width: 0; min-height: 40px; padding: 0 12px; border: 1px solid var(--ct-line2); border-radius: 10px; outline: 0; background: var(--ct-field); color: var(--ct-text); font: inherit; font-size: 13px; }
        .crack-folder-create-form input:focus, .crack-folder-inspector input:focus { background: var(--ct-raise); box-shadow: 0 0 0 1px var(--ct-line2), 0 0 0 4px var(--ct-ring); }
        .crack-folder-create-form input::placeholder { color: var(--ct-faint); }
        .crack-folder-create-form .crack-folder-create { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 40px; padding: 0 14px; border: 1px solid transparent; border-radius: 10px; background: var(--ct-ink); color: var(--ct-ink-fg); font: inherit; font-size: 12.5px; font-weight: 700; white-space: nowrap; cursor: pointer; }
        .crack-folder-create-form .crack-folder-create:hover:not(:disabled) { background: color-mix(in srgb, var(--ct-ink) 86%, var(--ct-raise)); }
        .crack-folder-create-form .crack-folder-create:disabled { opacity: .42; cursor: default; }
        .crack-folder-create svg { width: 16px; height: 16px; }
        .crack-folder-create-hint { grid-column: 1 / -1; margin: 0; color: var(--ct-muted); font-size: 12px; }
        .crack-folder-manage-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; min-height: 120px; max-height: 320px; overflow-y: auto; overscroll-behavior: contain; padding: 16px 20px; }
        .crack-folder-file { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-width: 0; min-height: 116px; padding: 12px 8px; border: 1px solid transparent; border-radius: 12px; background: transparent; color: var(--ct-text); font: inherit; cursor: pointer; }
        .crack-folder-file:hover { background: var(--ct-hover); }
        .crack-folder-file.is-selected { border-color: var(--ct-line2); background: var(--ct-current); }
        .crack-folder-file-icon { display: grid; place-items: center; width: 48px; height: 48px; color: var(--folder-color); }
        .crack-folder-file-icon svg { width: 42px; height: 42px; stroke-width: 1.7; }
        .crack-folder-file-name { display: -webkit-box; width: 100%; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; text-align: center; font-size: 13px; font-weight: 640; line-height: 1.35; }
        .crack-folder-manage-empty { grid-column: 1 / -1; align-self: center; padding: 24px 8px; color: var(--ct-muted); text-align: center; font-size: 13px; }
        .crack-folder-inspector { padding: 16px 20px 20px; border-top: 1px solid var(--ct-line); background: var(--ct-bg); }
        .crack-folder-inspector[hidden] { display: none; }
        .crack-folder-inspector-top { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
        .crack-folder-inspector-top strong { margin-right: auto; font-size: 12.5px; font-weight: 700; }
        .crack-folder-inspector-top button { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid var(--ct-line2); border-radius: 8px; background: transparent; color: var(--ct-muted); font: inherit; cursor: pointer; }
        .crack-folder-inspector-top button:hover:not(:disabled) { background: var(--ct-hover); color: var(--ct-text); }
        .crack-folder-inspector-top button:disabled { opacity: .35; cursor: default; }
        .crack-folder-inspector-top button svg { width: 15px; height: 15px; }
        .crack-folder-inspector-top .crack-folder-delete:hover { color: var(--ct-danger); }
        .crack-folder-inspector label { display: block; margin-bottom: 6px; color: var(--ct-muted); font-size: 12px; font-weight: 680; }
        .crack-folder-palette { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
        .crack-folder-palette button { width: 26px; height: 26px; padding: 0; border: 2px solid var(--ct-bg); border-radius: 50%; background: var(--swatch-color); cursor: pointer; }
        .crack-folder-palette button.is-selected { outline: 2px solid var(--ct-ink); outline-offset: 2px; }
        .crack-folder-manage button:focus-visible { outline: 2px solid var(--ct-ink); outline-offset: 2px; }
        @media (max-width: 700px) {
            .crack-folder-manage { align-items: end; padding: 0; }
            .crack-folder-manage-panel { width: 100%; max-height: 92dvh; overflow-y: auto; border-radius: 20px 20px 0 0; transform: translateY(40px); }
            .crack-folder-create-form { padding: 16px; }
            .crack-folder-manage-list { padding: 16px; max-height: 40dvh; }
            .crack-folder-inspector { padding: 16px; }
        }
        @media (prefers-reduced-motion: reduce) {
            .crack-folder-manage, .crack-folder-manage-panel { transition: none !important; }
        }
        @media (max-width: 700px) { .crack-lg-folder-tools { padding: 8px; } .crack-lg-folder-tools button, .crack-lg-folder-tools select { min-height: 44px; } }
        /* 선택 도구 (1.4.0): 체크는 프로필 사진 모서리 배지로만 표시하고, 줄 높이/정렬은 평소와 같게 둔다. */
        #crack-lounge .crack-lg-pick { position: absolute; z-index: 1; left: 36px; top: calc(50% + 5px); display: none; place-items: center; width: 18px; height: 18px; padding: 0; border: 2px solid var(--ct-raise); border-radius: 50%; background: var(--ct-knob); color: transparent; box-shadow: inset 0 0 0 1.5px var(--ct-faint); cursor: pointer; transition: background-color 140ms, color 140ms, box-shadow 140ms, transform 200ms var(--ct-spring); }
        #crack-lounge .crack-lg-pick svg { width: 10px; height: 10px; }
        #crack-lounge.is-selecting .crack-lg-pick { display: grid; }
        #crack-lounge .crack-lg-tile.is-picked .crack-lg-pick { background: var(--ct-ink); color: var(--ct-ink-fg); box-shadow: none; transform: scale(1.08); }
        #crack-lounge.is-selecting .crack-lg-tile.is-picked { border-color: var(--ct-ink); background: var(--ct-current); box-shadow: inset 0 0 0 1px var(--ct-ink); transform: none; }
        #crack-lounge.is-selecting .crack-lg-tile { cursor: pointer; }
        #crack-lounge.is-selecting .crack-lg-tile:hover { transform: none; }
        #crack-lounge.is-dense .crack-lg-pick { left: 22px; top: calc(50% + 1px); width: 15px; height: 15px; }
        #crack-lounge.is-dense .crack-lg-pick svg { width: 8px; height: 8px; }
        #crack-lounge.is-dense.is-selecting .crack-lg-tile.is-picked { box-shadow: inset 0 0 0 1px var(--ct-ink); }
        /* 선택 도구 줄이 숨겨져도 본문이 남은 높이(1fr) 칸에 남도록 줄을 고정한다. */
        #crack-lounge > .crack-lg-top { grid-row: 1; }
        #crack-lounge > .crack-lg-folder-tools { grid-row: 2; }
        #crack-lounge > .crack-lg-body { grid-row: 3; }
        #crack-lounge .crack-lg-folder-tools { gap: 6px; padding: 8px 16px; font-size: 12.5px; }
        #crack-lounge .crack-lg-folder-tools button { display: inline-flex; align-items: center; gap: 6px; height: 30px; min-height: 30px; padding: 0 10px; border: 0; border-radius: 8px; background: var(--ct-field); color: var(--ct-text); font-size: 12.5px; font-weight: 640; }
        #crack-lounge .crack-lg-folder-tools button:hover:not(:disabled) { background: var(--ct-hover2); }
        #crack-lounge .crack-lg-folder-tools button.is-primary { background: var(--ct-ink); color: var(--ct-ink-fg); }
        #crack-lounge .crack-lg-folder-tools button.is-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--ct-ink) 86%, var(--ct-raise)); }
        #crack-lounge .crack-lg-selected-count { margin: 0 auto 0 4px; color: var(--ct-muted); font-variant-numeric: tabular-nums; }
        @media (max-width: 700px) { #crack-lounge .crack-lg-folder-tools button { height: 40px; } }
        #crack-lounge button:focus-visible { outline: 2px solid var(--ct-ink); outline-offset: 2px; }
        @container (max-width: 700px) {
            .crack-lg-body { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
            .crack-lg-rail { display: flex; gap: 4px; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--ct-line); padding: 8px 10px; }
            .crack-lg-rail-btn { width: auto; flex: 0 0 auto; }
            .crack-lg-rail-h { display: none; }
        }

        /* Mobile lounge: full visual viewport, independent scroll areas. */
        #crack-lounge.is-mobile {
            border: 0; overflow: hidden;
            grid-template-rows: minmax(0, auto) auto minmax(0, 1fr);
            padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
            clip-path: none; transform: translateY(16px);
            transition: transform 240ms var(--ct-ease), opacity 180ms, visibility 0s 240ms;
        }
        #crack-lounge.is-mobile.is-open { transform: none; transition-delay: 0s; }
        #crack-lounge.is-mobile .crack-lg-top {
            display: grid; grid-template-columns: 44px minmax(0, 1fr) auto;
            gap: 6px; padding: 8px; max-height: 45vh; max-height: 45dvh;
            overflow: auto; overscroll-behavior: contain;
        }
        #crack-lounge.is-mobile .crack-lg-heading { min-width: 0; flex-wrap: wrap; gap: 2px 6px; }
        #crack-lounge.is-mobile .crack-lg-heading strong { font-size: 15px; }
        #crack-lounge.is-mobile .crack-lg-heading { grid-column: 2 / -1; grid-row: 1; }
        #crack-lounge.is-mobile .crack-lg-view-tools { grid-column: 1 / -1; grid-row: 2; justify-self: end; }
        #crack-lounge.is-mobile .crack-lg-quick-actions button { width: 44px; height: 44px; }
        #crack-lounge.is-mobile .crack-lg-search { grid-column: 1 / -1; grid-row: 3; max-width: none; height: 44px; }
        #crack-lounge.is-mobile .crack-lg-search input { font-size: 16px; }
        #crack-lounge.is-mobile .crack-lg-colors { grid-column: 1 / -1; grid-row: 4; min-width: 0; overflow-x: auto; gap: 0; padding: 0; border-radius: 12px; }
        #crack-lounge.is-mobile .crack-lg-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); overflow: hidden; }
        #crack-lounge.is-mobile .crack-lg-rail { display: flex; gap: 4px; overflow-x: auto; overflow-y: hidden; border-right: 0; border-bottom: 1px solid var(--ct-line); padding: 4px 8px; overscroll-behavior-x: contain; }
        #crack-lounge.is-mobile .crack-lg-rail-btn { width: auto; flex: 0 0 auto; max-width: 240px; }
        #crack-lounge.is-mobile .crack-lg-rail-h { display: none; }
        #crack-lounge.is-mobile .crack-lg-scroll { padding: 10px 10px 24px; min-width: 0; -webkit-overflow-scrolling: touch; }
        #crack-lounge.is-mobile .crack-lg-grid { grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr)); }
        #crack-lounge.is-mobile .crack-lg-tile { padding-right: 48px; min-height: 68px; transform: none; }
        #crack-lounge.is-mobile.is-dense .crack-lg-tile { min-height: 52px; }
        #crack-lounge.is-mobile .crack-lg-title { font-size: 14px; }
        #crack-lounge.is-mobile .crack-lg-date { display: none; }
        #crack-lounge.is-mobile .crack-lg-more { opacity: 1; top: 50%; margin-top: -22px; right: 2px; }
        #crack-lounge.is-mobile .crack-lg-close,
        #crack-lounge.is-mobile .crack-lg-clear,
        #crack-lounge.is-mobile .crack-lg-more { width: 44px; height: 44px; flex-basis: 44px; }
        #crack-lounge.is-mobile .crack-lg-seg button,
        #crack-lounge.is-mobile .crack-lg-rail-btn,
        #crack-lounge.is-mobile .crack-lg-more-btn { min-height: 44px; }
        #crack-lounge.is-mobile .crack-lg-cf,
        #crack-lounge.is-mobile .crack-lg-pop-dot { width: 44px; height: 44px; flex: 0 0 44px; background: radial-gradient(circle, var(--d) 0 9px, transparent 10px); outline-offset: -8px; transform: none; }
        #crack-lounge.is-mobile .crack-lg-cf.is-all { width: auto; min-width: 64px; flex: 0 0 auto; padding: 0 14px; background: transparent; outline: 0; }
        #crack-lounge.is-mobile .crack-lg-cf-add, #crack-lounge.is-mobile .crack-lg-pop-add { width: 44px; height: 44px; flex: 0 0 44px; border: 0; }
        #crack-lounge.is-mobile .crack-lg-colors { justify-self: start; max-width: 100%; }
        #crack-lounge.is-mobile .crack-lg-cf.is-all.is-on { background: var(--ct-knob); }
        #crack-lounge.is-mobile .crack-lg-pop { max-width: calc(100% - 16px); padding: 8px; }
        #crack-lounge.is-mobile .crack-lg-pop-row { flex-wrap: wrap; gap: 0; }
        #crack-lounge.is-mobile .crack-lg-pop-label { flex: 0 0 100%; padding: 0 8px 4px; }
        #crack-lounge.is-mobile .crack-lg-pop-folder { min-height: 44px; }
        #crack-lounge.is-mobile button { touch-action: manipulation; }
        @media (max-width: 280px) {
            #crack-lounge.is-mobile .crack-lg-seg button { padding: 6px 4px; font-size: 11px; }
            #crack-lounge.is-mobile .crack-lg-view-tools { gap: 4px; }
            #crack-lounge.is-mobile .crack-lg-quick-actions button { width: 32px; height: 36px; }
        }
        @media (max-width: 900px), (pointer: coarse) {
            .crack-lounge-btn { width: 44px; height: 44px; flex-basis: 44px; }
            .crack-lg-more { opacity: 1; }
        }

        /* ── 터치 기기 / 동작 줄이기 ── */
        @media (hover: none), (pointer: coarse) {
            .crack-search-input { font-size: 16px; }
            #crack-search-overlay .crack-api-result-item { min-height: 48px; }
            .crack-smart-button { min-height: 42px; }
            .crack-smart-close { width: 40px; height: 40px; }
            .marquee-target.can-animate:hover { animation: none; }
        }
        @media (prefers-reduced-motion: reduce) {
            .crack-search-box, .crack-search-icon, .crack-search-clear,
            .crack-lounge-btn, .crack-lounge-btn rect,
            .crack-chat-item, .crack-chat-item > span.rounded-full:first-child,
            .custom-palette-dot, #crack-search-overlay .crack-api-result-item,
            .crack-smart-organize-menu-item, .crack-spark path,
            .crack-so, .crack-so *, .crack-so *::before, .crack-so *::after,
            #crack-lounge, #crack-lounge *, #crack-lounge *::before, #crack-lounge *::after {
                transition-duration: 1ms !important;
                transition-delay: 0s !important;
                animation: none !important;
            }
            #crack-search-overlay.visible,
            .marquee-target.can-animate:hover,
            .crack-section-count { animation: none !important; }
            .crack-so-check circle, .crack-so-check path { stroke-dashoffset: 0 !important; }
            .crack-so-apply li.is-done .crack-so-st::after { transform: rotate(45deg) !important; }
            #crack-lounge { clip-path: none !important; }
        }
    `);

    // 비동기 딜레이 헬퍼
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));


    // ── v1.2.0 디자인 헬퍼 (새 UI 조각 생성용) ──
    function ctEl(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    }

    function ctSvg(body, size = 16) {
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    }

    function ctSparkIcon(size = 16) {
        return `<svg class="crack-spark" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">` +
            '<path class="ct-s1" d="M11 3C11.6 7.6 14.4 10.4 19 11C14.4 11.6 11.6 14.4 11 19C10.4 14.4 7.6 11.6 3 11C7.6 10.4 10.4 7.6 11 3Z"/>' +
            '<path class="ct-s2" d="M19 1.8C19.2 3.2 19.8 3.8 21.2 4C19.8 4.2 19.2 4.8 19 6.2C18.8 4.8 18.2 4.2 16.8 4C18.2 3.8 18.8 3.2 19 1.8Z"/>' +
            '<path class="ct-s3" d="M20 17.5C20.1 18.4 20.6 18.9 21.5 19C20.6 19.1 20.1 19.6 20 20.5C19.9 19.6 19.4 19.1 18.5 19C19.4 18.9 19.9 18.4 20 17.5Z"/>' +
            '</svg>';
    }

    const CT_ICON = {
        search: ctSvg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 15),
        x: ctSvg('<path d="M18 6 6 18M6 6l12 12"/>', 13),
        back: ctSvg('<path d="M14.5 6 8.5 12l6 6"/>', 17),
        dots: ctSvg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>', 16),
        grid: ctSvg('<rect class="ct-g1" x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect class="ct-g2" x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect class="ct-g3" x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect class="ct-g4" x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>', 16),
        all: ctSvg('<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>', 15),
        chat: ctSvg('<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 20 12z"/>', 15),
        folder: ctSvg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', 15),
        plus: ctSvg('<path d="M12 5v14M5 12h14"/>', 18),
        select: ctSvg('<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="m7.5 12 3 3 6-6"/>', 18),
        settings: ctSvg('<path d="M10.5 3h3l.5 2.1 1.7.7 1.9-1.1 2.1 2.1-1.1 1.9.7 1.7L21 11v3l-2.1.5-.7 1.7 1.1 1.9-2.1 2.1-1.9-1.1-1.7.7L13.5 21h-3l-.5-2.1-1.7-.7-1.9 1.1-2.1-2.1 1.1-1.9-.7-1.7L3 14v-3l2.1-.5.7-1.7-1.1-1.9 2.1-2.1 1.9 1.1 1.7-.7z"/><circle cx="12" cy="12.5" r="2.6"/>', 15),
        alert: ctSvg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>', 26)
    };

    function readSavedArchiveHeight() {
        try {
            const raw = localStorage.getItem(ARCHIVE_HEIGHT_KEY);
            const value = Number.parseInt(raw || '', 10);
            return Number.isFinite(value) && value >= ARCHIVE_HEIGHT_MIN ? value : null;
        } catch (e) {
            return null;
        }
    }

    function setArchiveHeightValue(height) {
        if (!height) return;

        document.documentElement.style.setProperty('--crack-archive-h', `${height}px`);

        try {
            localStorage.setItem(ARCHIVE_HEIGHT_KEY, String(height));
        } catch (e) {}
    }

    // document-start 시점에 저장 높이를 CSS 변수로 먼저 올려둔다.
    // React가 사이드바를 다시 그릴 때 기본 높이가 번쩍 보이는 현상을 줄이기 위함.
    const initialArchiveHeight = readSavedArchiveHeight();
    if (initialArchiveHeight && document.documentElement) {
        document.documentElement.style.setProperty('--crack-archive-h', `${initialArchiveHeight}px`);
    }

    function findArchiveDivider() {
        const dividers = Array.from(document.querySelectorAll('.border-t'));

        return dividers.find(el => {
            const prevText = cleanText(el.previousElementSibling?.textContent || '');
            const nextText = cleanText(el.nextElementSibling?.textContent || '');

            // 현재 DOM: [보관함 섹션] [border-t] [채팅 목록 헤더]
            // 구형 DOM: border 다음 형제에 보관함/채팅 목록 텍스트가 붙어 있던 구조
            return (
                (prevText.includes('보관함') && nextText.includes('채팅 목록')) ||
                nextText.includes('채팅 목록') ||
                nextText.includes('보관함')
            );
        }) || null;
    }

    function isLiveArchiveContainer(el) {
        if (!(el instanceof HTMLElement) || !el.isConnected) return false;
        return !!el.querySelector?.('button[aria-label="보관함 전체보기"]') ||
            el.matches?.('.crack-archive-resized');
    }

    function resetArchiveCache() {
        cachedArchiveDivider = null;
        cachedArchiveContainer = null;
    }

    function findArchiveContainerByButton(scope = document) {
        const root = scope instanceof HTMLElement || scope === document ? scope : document;
        const buttons = Array.from(root.querySelectorAll?.('button[aria-label="보관함 전체보기"]') || []);

        for (const button of buttons) {
            if (!isInActiveSidebar(button)) continue;

            // 상대 확프에서 스크롤이 살아난 핵심 타겟:
            // div.flex.flex-col:has(> div > button[aria-label="보관함 전체보기"])
            // :has 의존을 줄이려고 JS로 같은 구조를 직접 찾는다.
            const directChild = button.parentElement;
            for (let el = directChild?.parentElement, depth = 0; el && el !== document.body && depth < 8; el = el.parentElement, depth += 1) {
                if (!(el instanceof HTMLElement)) continue;
                if (!el.classList?.contains('flex') || !el.classList?.contains('flex-col')) continue;

                if (directChild && directChild.parentElement === el) return el;
                if (Array.from(el.children || []).some(child => child instanceof HTMLElement && child.contains(button))) return el;
            }
        }

        return null;
    }

    function getArchiveContainerFromDivider(divider) {
        if (!divider) return findArchiveContainerByButton(document);

        const previous = divider.previousElementSibling;
        if (!previous) return findArchiveContainerByButton(document);

        // 1순위: 보관함 전체보기 버튼을 기준으로 실제 스크롤 박스 flex-col을 잡는다.
        // 기존처럼 .overflow-hidden 내부 요소를 잡으면 max-height는 먹어도 스크롤이 막힐 수 있다.
        const buttonTarget = findArchiveContainerByButton(previous);
        if (buttonTarget) return buttonTarget;

        // 2순위: 기존 로직 유지. 단, overflow-hidden은 스크롤 컨테이너로 쓰기 전에 auto로 강제될 예정이다.
        if (previous.classList?.contains('overflow-hidden')) return previous;

        const directOverflow = Array.from(previous.children || [])
            .find(el => el.classList?.contains('overflow-hidden'));
        if (directOverflow) return directOverflow;

        return previous.querySelector(':scope > .overflow-hidden, :scope > .overflow-y-auto, :scope > .scrollbar') ||
            previous.querySelector('.overflow-y-auto, .scrollbar') ||
            findArchiveContainerByButton(document) ||
            null;
    }

    function getArchivePartsCached() {
        if (isLiveArchiveContainer(cachedArchiveContainer)) {
            if (!(cachedArchiveDivider instanceof HTMLElement) || !cachedArchiveDivider.isConnected) {
                cachedArchiveDivider = findArchiveDivider();
            }

            return {
                divider: cachedArchiveDivider,
                archiveContainer: cachedArchiveContainer
            };
        }

        const divider = findArchiveDivider();
        const archiveContainer = getArchiveContainerFromDivider(divider);

        cachedArchiveDivider = divider || null;
        cachedArchiveContainer = archiveContainer || null;

        return { divider, archiveContainer };
    }

    function applyArchiveScrollBox(archiveContainer, height) {
        if (!archiveContainer) return;

        const safeHeight = Math.max(ARCHIVE_HEIGHT_MIN, Number.parseInt(height || '', 10) || ARCHIVE_HEIGHT_DEFAULT);
        document.documentElement.style.setProperty('--crack-archive-h', `${safeHeight}px`);

        // 같은 DOM/같은 높이에 반복 적용되는 경우가 제일 많아서 여기서 바로 탈출한다.
        if (archiveContainer === lastArchiveScrollTarget && lastArchiveAppliedHeight === safeHeight && archiveContainer.classList.contains('crack-archive-resized')) {
            return;
        }

        if (archiveContainer !== lastArchiveScrollTarget) {
            cleanupWrongArchiveResizeTargets(archiveContainer);
            lastArchiveScrollTarget = archiveContainer;
        }

        lastArchiveAppliedHeight = safeHeight;
        archiveContainer.classList.add('crack-archive-resized');
        archiveContainer.style.setProperty('max-height', `${safeHeight}px`, 'important');
        archiveContainer.style.setProperty('transition', 'none', 'important');
    }

    function cleanupWrongArchiveResizeTargets(archiveContainer) {
        document.querySelectorAll('.crack-archive-resized').forEach(el => {
            if (el === archiveContainer) return;
            if (el.classList?.contains('border-t')) return;

            // v1.0.4에서 내부 overflow-hidden 버튼/자식에 max-height가 먹은 경우 제거
            el.classList.remove('crack-archive-resized');
            el.style.removeProperty('max-height');
            el.style.removeProperty('overflow-y');
            el.style.removeProperty('overflow-x');
            el.style.removeProperty('overscroll-behavior');
            el.style.removeProperty('padding-bottom');
            el.style.removeProperty('transition');
        });
    }

    function applySavedArchiveHeightFast() {
        const { archiveContainer } = getArchivePartsCached();
        if (!archiveContainer) return null;

        // 저장값이 없어도 기본 높이를 줘야 overflow-y가 실제로 스크롤 영역을 만든다.
        // 저장은 드래그 종료 시에만 하므로 기존 사용자 설정 로직은 유지된다.
        const height = readSavedArchiveHeight() || ARCHIVE_HEIGHT_DEFAULT;
        applyArchiveScrollBox(archiveContainer, height);

        return archiveContainer;
    }

    function scheduleArchiveHeightFastApply() {
        if (archiveFastApplyRaf) return;

        archiveFastApplyRaf = requestAnimationFrame(() => {
            archiveFastApplyRaf = 0;
            applySavedArchiveHeightFast();
        });
    }

    // 텍스트 정제 헬퍼
    function cleanText(text) {
        return (text || '').replace(/\s+/g, ' ').trim();
    }

    // 검색/스캔에서 제외할 사이드바 헤더 이름 필터
    function isBadHeaderName(name) {
        return /^(보관함|채팅 목록|채팅목록|전체|메뉴|에피소드|파티챗)$/.test(cleanText(name));
    }

    // 실제 사이드바 내부 요소인지 확인하는 가드
    function isInActiveSidebar(el) {
        if (!el) return false;

        if (el.closest('[data-message-group-id], .wrtn-markdown, .__chat_input_textarea, #crack-search-overlay, #crack-smart-organize-modal, .crack-so, #crack-lounge, #crack-local-folders, #crack-folder-results, #crack-folder-manager, #crack-local-assign')) return false;

        // 1. 드롭다운 메뉴, 팝오버, 라디오그룹 내부 제외
        if (
            el.closest('[role="menu"]') ||
            el.closest('[role="popover"]') ||
            el.closest('[role="radiogroup"]')
        ) {
            return false;
        }

        // 2. 보관함 이동 팝업 다이얼로그 및 편집 도구창 제외 (순정 사이드바는 필터 통과)
        const dialog = el.closest('[role="dialog"]');
        if (dialog) {
            if (
                dialog.textContent.includes('보관함 이동') ||
                dialog.querySelector('h2')?.textContent?.includes('이동') ||
                dialog.querySelector('button[aria-label="편집 종료"]')
            ) {
                return false;
            }
        }

        return true;
    }

    // 엘리먼트 내부에서 채팅 이름이나 텍스트를 추출해내는 안전 함수
    function getNameText(container) {
        if (!container) return '';

        const selectors = [
            '.text-popover-foreground.whitespace-nowrap',
            '.text-popover-foreground',
            '.typo-text-sm_leading-none_medium',
            '[class*="typo-text-sm"]'
        ];

        for (const selector of selectors) {
            const el = container.querySelector(selector);
            const text = cleanText(el?.textContent);
            if (text) return text;
        }

        return '';
    }

    function isRealChatLink(el) {
        if (!(el instanceof HTMLElement)) return false;
        if (el.closest('#crack-folder-results')) return false;
        if (!isInActiveSidebar(el)) return false;
        if (el.tagName.toLowerCase() !== 'a') return false;
        if (el.closest('[role="tablist"]')) return false;

        const name = getNameText(el);
        if (name && isBadHeaderName(name)) return false;

        const href = el.getAttribute('href');
        if (!href) return false;

        try {
            const url = new URL(href, location.origin);
            const parts = url.pathname.split('/').filter(Boolean);

            if (parts.length <= 1) return false;

            return parts.includes('episodes') || parts.includes('stories');
        } catch {
            return false;
        }
    }
    // 채팅방 고유 ID 파싱
    // 채팅방 고유 ID는 episode ID를 우선 사용합니다.
    function getChatId(container) {
        if (!container) return null;

        const tag = container.tagName.toLowerCase();

        // 1. 일반/보관함 내부 개별 채팅방 (a 링크 구조)
        if (tag === 'a') {
            if (!isRealChatLink(container)) return null;

            const href = container.getAttribute('href');
            if (!href) return null;

            const episodeMatch = href.match(/\/episodes\/([a-f0-9]+)/i);
            if (episodeMatch && episodeMatch[1]) {
                return `episode_${episodeMatch[1]}`;
            }

            const storyMatch = href.match(/\/stories\/([a-f0-9]+)/i);
            if (storyMatch && storyMatch[1]) {
                return `story_${storyMatch[1]}`;
            }

            return `chat_${href}`;
        }

        // 2. 보관함 폴더 버튼은 채팅방 팔레트 대상이 아니지만,
        //    기존 보관함 색상 표시가 필요할 수 있어 별도 archive ID만 유지한다.
        const name = getNameText(container);
        if (name && !isBadHeaderName(name)) {
            return `archive_${cleanText(name)}`;
        }

        return null;
    }

    function getChatContainers() {
        return Array.from((getListScope() || document).querySelectorAll('a[href*="/episodes"], a[href*="/stories"]'))
            .filter(isRealChatLink);
    }

    function applyVisualColor(container, colorKey) {
        if (!container) return;

        container.classList.add('crack-chat-item');

        // v1.1.5 이하가 남긴 인라인 색/그림자는 정리한다. 이제 모양은 CSS(프로필 링)가 맡는다.
        ['background-color', 'box-shadow', 'border-top', 'border-bottom'].forEach(prop => {
            container.style.removeProperty(prop);
        });

        if (!colorKey || colorKey === 'none') {
            // CSS 변수는 남겨 두어야 링이 부드럽게 사라진다.
            container.removeAttribute('data-chat-color');
            return;
        }

        const themeColors = getThemeColors();
        const accent = themeColors.accents?.[colorKey] || colorValues[colorKey];
        const bg = themeColors.backgrounds?.[colorKey] || 'transparent';

        container.style.setProperty('--crack-accent', accent);
        container.style.setProperty('--crack-color-bg', bg);
        container.setAttribute('data-chat-color', colorKey);
    }

    function paintSameChat(id, colorKey) {
        getChatContainers().forEach(container => {
            if (getChatId(container) === id) {
                applyVisualColor(container, colorKey);
                markCurrentChat(container);
            }
        });
    }

    function saveColor(id, colorKey) {
        if (!id) return;
        // 사이드바 색상 모아보기는 다음 updateUI(메뉴가 닫힌 뒤)에서 다시 그린다.
        colorVersion++;

        try {
            if (!colorKey || colorKey === 'none') {
                localStorage.removeItem(STORAGE_KEY + id);
                paintSameChat(id, null);
                return;
            }

            localStorage.setItem(STORAGE_KEY + id, colorKey);
            paintSameChat(id, colorKey);
        } catch (e) {
            console.warn("[Crack UI] LocalStorage 저장 실패:", e);
        }
    }

    function isCurrentChat(container) {
        if (!container) return false;

        if (container.getAttribute('aria-current') === 'page') return true;
        if (container.dataset.state === 'active') return true;
        if (container.getAttribute('data-state') === 'active') return true;

        const href = container.getAttribute?.('href');
        if (!href) return false;

        try {
            const url = new URL(href, location.origin);
            const targetPath = url.pathname.replace(/\/+$/, '');
            const currentPath = location.pathname.replace(/\/+$/, '');

            if (!targetPath || targetPath === '/episodes' || targetPath === '/stories') return false;

            return currentPath === targetPath || currentPath.startsWith(targetPath + '/');
        } catch {
            return false;
        }
    }

    // 현재 채팅 표시 (강조 모양은 CSS .crack-current-chat 이 담당)
    function markCurrentChat(container) {
        if (!container) return;

        container.classList.add('crack-chat-item');
        container.classList.toggle('crack-current-chat', isCurrentChat(container));
    }

    function findChatContainerFromMenuButton(trigger) {
        if (!trigger) return null;

        // 팔레트는 오직 개별 채팅방의 메뉴 버튼에서만 허용한다.
        // 보관함 메뉴/채팅 목록 상단 메뉴/기타 드롭다운은 여기서 전부 탈락한다.
        if (trigger.getAttribute('aria-label') !== '채팅방 메뉴') return null;

        const link = trigger.closest('a[href*="/episodes"], a[href*="/stories"]');
        if (link && isRealChatLink(link)) return link;

        return null;
    }

    // Radix 채팅방 메뉴가 열린 동안에는 튜너가 사이드바 DOM을 건드리지 않는다.
    // 메뉴 Content는 body 포털에 있으므로 트리거의 open 상태를 기준으로 판별한다.
    function isChatMenuOpen() {
        return !!document.querySelector(
            'button[aria-label="채팅방 메뉴"][data-state="open"], ' +
            'button[aria-label="채팅방 메뉴"][aria-expanded="true"]'
        );
    }

    function rememberMenuTarget(e) {
        const trigger = e.target.closest?.('button[aria-haspopup="menu"]');

        if (!trigger) return;

        // 다른 메뉴를 누른 순간, 직전에 잡아둔 채팅방 대상을 반드시 비운다.
        if (trigger.getAttribute('aria-label') !== '채팅방 메뉴') {
            lastMenuTarget = null;
            lastMenuTime = 0;
            return;
        }

        const container = findChatContainerFromMenuButton(trigger);
        const id = getChatId(container);

        if (container && id) {
            lastMenuTarget = {
                container,
                id,
                trigger,
                triggerId: trigger.id || '',
                menuId: trigger.getAttribute('aria-controls') || ''
            };
            lastMenuTime = Date.now();
        } else {
            lastMenuTarget = null;
            lastMenuTime = 0;
        }
    }

    document.addEventListener('pointerdown', rememberMenuTarget, true);

    // One delegated handler also covers virtualized/remounted chat rows.
    function openChatMenuFromContext(event) {
        // Shift+right-click keeps the browser menu; don't hijack mobile long-press.
        if (event.defaultPrevented || event.shiftKey || event.pointerType === 'touch') return;
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (!target || target.closest('input, textarea, [contenteditable="true"], [role="menu"]')) return;

        // 사이드바 폴더 보기의 카드는 크랙 메뉴가 없으므로 폴더 선택 창을 바로 연다.
        const card = target.closest('#crack-folder-results .crack-folder-card');
        if (card) {
            event.preventDefault();
            event.stopPropagation();
            openLocalAssignMenu({
                x: event.clientX, y: event.clientY,
                hrefs: [card.dataset.folderHref],
                title: card.querySelector('.crack-folder-card-title')?.textContent || ''
            });
            return;
        }

        const tile = target.closest('#crack-lounge .crack-lg-tile');
        if (tile) {
            const button = tile.querySelector('.crack-lg-more');
            if (!button || button.disabled) return;
            event.preventDefault();
            event.stopPropagation();
            if (loungeState.popChatId !== tile.dataset.chatId) openLoungePop(button);
            return;
        }

        const link = target.closest('a[href*="/episodes"], a[href*="/stories"]');
        if (!link || !isRealChatLink(link)) return;
        const trigger = link.querySelector('button[aria-label="채팅방 메뉴"][aria-haspopup="menu"]');
        if (!trigger || trigger.disabled || trigger.getAttribute('aria-disabled') === 'true') return;

        event.preventDefault();
        event.stopPropagation();
        rememberMenuTarget({ target: trigger });
        if (trigger.getAttribute('data-state') === 'open' || trigger.getAttribute('aria-expanded') === 'true') return;

        // Radix opens on left pointerdown, not HTMLElement.click(). No link click
        // is dispatched, so the current chat is not navigated away from.
        trigger.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, cancelable: true, composed: true,
            button: 0, buttons: 1, pointerType: 'mouse', isPrimary: true,
            clientX: event.clientX, clientY: event.clientY
        }));
    }
    document.addEventListener('contextmenu', openChatMenuFromContext, true);



    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            lastMenuTarget = null;
            if (smartOrganizeState.open && !smartOrganizeState.busy) {
                closeSmartOrganize();
            }
        }
    });

    function injectPalette(menuNode) {
        if (!menuNode) return;

        if (!lastMenuTarget || !lastMenuTarget.container || !lastMenuTarget.id) return;
        if (Date.now() - lastMenuTime > 3000) return;

        // 현재 열린 메뉴가 방금 누른 채팅방 메뉴와 연결된 메뉴인지 확인한다.
        // aria-controls/id는 Radix가 여는 동안 붙이는 임시값이라 있을 때만 보조 확인용으로 사용한다.
        if (lastMenuTarget.menuId && menuNode.id && lastMenuTarget.menuId !== menuNode.id) return;
        if (lastMenuTarget.triggerId && menuNode.getAttribute('aria-labelledby') && menuNode.getAttribute('aria-labelledby') !== lastMenuTarget.triggerId) return;

        // 메뉴 내용이 채팅방 메뉴 구성인지 2차 확인한다. 다른 메뉴에 팔레트가 묻어나는 것을 방지한다.
        const menuText = cleanText(menuNode.textContent);
        const looksLikeChatMenu =
            menuText.includes('이름 변경') &&
            menuText.includes('삭제') &&
            (menuText.includes('고정') || menuText.includes('고정 해제'));
        if (!looksLikeChatMenu) return;

        menuNode.classList.add('crack-menu-solid');

        // 같은 메뉴에 팔레트를 제거/재삽입하면 Radix의 포커스·선택 상태가 흔들릴 수 있다.
        // 이미 주입된 경우에는 DOM을 더 바꾸지 않는다.
        if (menuNode.querySelector(':scope > .custom-palette-container')) return;

        const wrap = document.createElement('div');
        wrap.className = 'custom-palette-container';
        let currentColor = null;
        try {
            currentColor = localStorage.getItem(STORAGE_KEY + lastMenuTarget.id);
        } catch (e) {}

        Object.keys(colorValues).forEach(key => {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.dataset.color = key;
            dot.setAttribute('aria-pressed', String(currentColor === key));
            dot.className = `custom-palette-dot ${currentColor === key ? 'active' : ''}`;
            dot.style.backgroundColor = colorValues[key];
            dot.title = currentColor === key ? `${colorLabel(key)} 색상 제거` : `${colorLabel(key)} 색상 적용`;
            dot.setAttribute('aria-label', dot.title);

            const applyPaletteColor = e => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                const target = lastMenuTarget;
                if (!target || !target.id) {
                    console.warn('[Crack UI] 색상 적용 실패: 채팅방 대상을 찾지 못했습니다.');
                    return;
                }

                let saved = null;
                try {
                    saved = localStorage.getItem(STORAGE_KEY + target.id);
                } catch (err) {}

                // 이미 같은 색이면 제거, 아니면 해당 색 적용
                const nextColor = saved === key ? null : key;
                saveColor(target.id, nextColor);

                wrap.querySelectorAll('.custom-palette-dot').forEach(button => {
                    const selected = button.dataset.color === nextColor;
                    button.classList.toggle('active', selected);
                    button.setAttribute('aria-pressed', String(selected));
                    button.title = `${colorLabel(button.dataset.color)} 색상 ${selected ? '제거' : '적용'}`;
                    button.setAttribute('aria-label', button.title);
                });
            };
            dot.addEventListener('pointerdown', applyPaletteColor, true);

            dot.addEventListener('click', e => {
                if (e.detail === 0) { applyPaletteColor(e); return; }
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }, true);

            wrap.appendChild(dot);
        });

        const addDot = document.createElement('button');
        addDot.type = 'button';
        addDot.className = 'custom-palette-dot custom-palette-add';
        addDot.title = '색 추가';
        addDot.setAttribute('aria-label', '색 추가');
        addDot.innerHTML = ctSvg('<path d="M12 6v12M6 12h12"/>', 13);
        const openAddColor = e => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            const target = lastMenuTarget;
            if (!target || !target.id) return;
            pickCustomColor(addDot, key => saveColor(target.id, key));
        };
        addDot.addEventListener('pointerdown', openAddColor, true);
        addDot.addEventListener('click', e => {
            if (e.detail === 0) { openAddColor(e); return; }
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        }, true);
        wrap.appendChild(addDot);

        menuNode.append(ctEl('div', 'crack-menu-sep'), makeFolderMenuItem(menuNode, lastMenuTarget), wrap);
    }

    // 채팅방 메뉴의 "폴더에 넣기": 메뉴를 닫고 같은 자리에 폴더 선택 창을 띄운다.
    function makeFolderMenuItem(menuNode, target) {
        const href = target.container?.getAttribute('href') || '';
        const folderId = loadLocalMap()[localChatKey(href)] || LOCAL_ROOT_ID;
        const folder = folderId === LOCAL_ROOT_ID ? null : loadLocalFolders().find(entry => entry.id === folderId);

        const item = ctEl('div', 'crack-smart-organize-menu-item crack-folder-menu-item');
        item.setAttribute('role', 'menuitem');
        item.setAttribute('tabindex', '-1');
        if (folder) item.style.setProperty('--folder-color', folder.color);
        const icon = ctEl('span', 'crack-smart-organize-menu-icon');
        icon.innerHTML = CT_ICON.folder;
        item.append(icon, ctEl('span', 'crack-smart-organize-menu-label', folder ? '폴더 옮기기' : '폴더에 넣기'));
        if (folder) item.append(ctEl('span', 'crack-folder-menu-current', folder.name));

        const open = () => {
            const rect = menuNode.getBoundingClientRect();
            const title = getNameText(target.container) || '';
            closeRadixMenu(menuNode);
            openLocalAssignMenu({ x: rect.left, y: rect.top, hrefs: [href], title, waitFor: menuNode });
        };
        // Radix 항목이 아니므로 직접 처리한다. click에서 열어야 같은 손동작의 클릭이 새 창에 떨어지지 않는다.
        item.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); }, true);
        item.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (href) open();
        }, true);
        item.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
            if (href) open();
        });
        return item;
    }

    // 크랙은 react-hotkeys-hook이 keyup 없는 keydown을 계속 눌린 키로 기억하므로 가짜 Escape를 쓰지 않는다.
    // Radix 트리거의 onPointerDown(왼쪽 버튼, Ctrl 없음)이 열림 상태를 토글하는 것을 이용해 닫는다.
    function closeRadixMenu(menuNode) {
        const ids = String(menuNode?.getAttribute?.('aria-labelledby') || '').split(/\s+/).filter(Boolean);
        const trigger = ids.map(id => document.getElementById(id)).find(el => el?.getAttribute('data-state') === 'open') ||
            document.querySelector('button[aria-haspopup="menu"][data-state="open"]');
        if (!trigger) return;
        trigger.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, cancelable: true, composed: true,
            button: 0, buttons: 1, pointerType: 'mouse', isPrimary: true, ctrlKey: false
        }));
    }

    function injectSmartAutoOrganizeMenu(menuNode) {
        if (!(menuNode instanceof HTMLElement)) return;
        if (menuNode.querySelector('.crack-smart-organize-menu-item:not(.crack-folder-menu-item)')) return;

        const candidates = Array.from(menuNode.querySelectorAll('[role="menuitem"], button, [data-radix-collection-item]'));
        const nativeAutoOrganize = candidates.find(item => {
            const text = cleanText(item.textContent || '');
            return text === '자동 정리' || text.includes('자동 정리');
        });
        if (!nativeAutoOrganize) return;

        const item = document.createElement('div');
        item.className = 'crack-smart-organize-menu-item';
        item.setAttribute('role', 'menuitem');
        item.setAttribute('tabindex', '-1');

        const icon = document.createElement('span');
        icon.className = 'crack-smart-organize-menu-icon';
        icon.innerHTML = ctSparkIcon(16);

        const label = document.createElement('span');
        label.className = 'crack-smart-organize-menu-label';
        label.textContent = '스마트 자동 정리';

        const badge = document.createElement('span');
        badge.className = 'crack-smart-organize-menu-badge';
        badge.textContent = '추천';

        item.append(icon, label, badge);

        item.addEventListener('pointerdown', event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            closeRadixMenu(menuNode);
            setTimeout(() => openSmartOrganize(), 60);
        }, true);

        item.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        }, true);

        const parent = nativeAutoOrganize.parentElement || menuNode;
        parent.insertBefore(item, nativeAutoOrganize);
        menuNode.classList.add('crack-menu-solid');
    }

    function isSmartOrganizeRunActive(runId) {
        return smartOrganizeState.open && smartOrganizeState.runId === runId;
    }

    function getSmartOrganizeRoot() {
        return document.getElementById('crack-smart-organize-modal');
    }

    function getSmartOrganizeParts() {
        const root = getSmartOrganizeRoot();
        if (!root) return {};
        return {
            root,
            title: root.querySelector('.crack-smart-title'),
            subtitle: root.querySelector('.crack-smart-subtitle'),
            close: root.querySelector('.crack-smart-close'),
            body: root.querySelector('.crack-smart-body'),
            foot: root.querySelector('.crack-smart-foot')
        };
    }

    function ensureSmartOrganizeModal() {
        let root = getSmartOrganizeRoot();
        if (root) return root;

        root = document.createElement('div');
        root.id = 'crack-smart-organize-modal';
        root.className = 'crack-so';
        root.dataset.phase = 'loading';
        root.innerHTML = `
            <section class="crack-so-dlg" role="dialog" aria-modal="true" aria-labelledby="crack-smart-title" tabindex="-1">
                <header class="crack-smart-head">
                    <span class="crack-so-mark">${ctSparkIcon(22)}</span>
                    <div class="crack-smart-title-wrap">
                        <h2 class="crack-smart-title" id="crack-smart-title">스마트 자동 정리</h2>
                        <div class="crack-smart-subtitle">동명 보관함을 확인하고 안전하게 정리합니다.</div>
                    </div>
                    <button type="button" class="crack-smart-close" aria-label="닫기">${CT_ICON.x}</button>
                </header>
                <ol class="crack-so-steps">
                    <li><span class="crack-so-ln"></span>불러오기</li>
                    <li><span class="crack-so-ln"></span>검토</li>
                    <li><span class="crack-so-ln"></span>적용</li>
                    <li><span class="crack-so-ln"></span>완료</li>
                </ol>
                <main class="crack-smart-body"></main>
                <footer class="crack-smart-foot"></footer>
            </section>
        `;

        root.addEventListener('pointerdown', event => {
            if (event.target === root && !smartOrganizeState.busy) closeSmartOrganize();
        });

        root.querySelector('.crack-smart-close').addEventListener('click', () => closeSmartOrganize());
        document.body.appendChild(root);

        requestAnimationFrame(() => {
            root.classList.add('is-open');
            root.querySelector('.crack-so-dlg')?.focus({ preventScroll: true });
        });
        return root;
    }

    function closeSmartOrganize(force = false) {
        if (smartOrganizeState.busy && !force && ['preparing', 'applying'].includes(smartOrganizeState.phase)) return;

        smartOrganizeState.runId += 1;
        smartOrganizeState.open = false;
        smartOrganizeState.busy = false;
        smartOrganizeState.phase = 'idle';
        smartOrganizeState.previewId = '';
        smartOrganizeState.rows = [];
        smartOrganizeState.status = '';
        smartOrganizeState.singletonStatus = 'idle';
        smartOrganizeState.singletonCount = 0;
        smartOrganizeState.singletonError = '';
        smartOrganizeState.result = null;

        // 닫힘 애니메이션 동안 id를 먼저 떼어, 곧바로 다시 열어도 새 창이 만들어지게 한다.
        const root = getSmartOrganizeRoot();
        if (root) {
            root.removeAttribute('id');
            root.classList.remove('is-open');
            root.classList.add('is-closing');
            setTimeout(() => root.remove(), 220);
        }
    }

    function setSmartOrganizeHeader(title, subtitle) {
        const parts = getSmartOrganizeParts();
        if (parts.title) parts.title.textContent = title;
        if (parts.subtitle) parts.subtitle.textContent = subtitle;
    }

    function setSmartSteps(phase) {
        const root = getSmartOrganizeRoot();
        if (!root) return;

        root.dataset.phase = phase;
        const index = { loading: 0, review: 1, preparing: 2, applying: 2, done: 3, error: 0 }[phase] ?? 0;
        root.querySelectorAll('.crack-so-steps li').forEach((li, i) => {
            if (phase === 'error') li.className = i === 0 ? 'is-err' : '';
            else if (phase === 'done') li.className = 'is-done';
            else li.className = i < index ? 'is-done' : i === index ? 'is-now' : '';
        });
    }

    function makeSmartBusyButton(label) {
        const button = ctEl('button', 'crack-smart-button primary');
        button.type = 'button';
        button.disabled = true;
        button.append(ctEl('span', 'crack-so-spin'), document.createTextNode(label));
        return button;
    }

    function renderSmartOrganizeLoading(title, status, phase = 'loading') {
        ensureSmartOrganizeModal();
        smartOrganizeState.phase = phase;
        smartOrganizeState.status = status;
        setSmartOrganizeHeader(title, phase === 'preparing'
            ? '실제로 옮기기 전에 대상 채팅을 먼저 모두 확인해요.'
            : '크랙의 자동 정리 미리보기를 불러와 기존 보관함과 비교해요.');
        setSmartSteps(phase);

        const parts = getSmartOrganizeParts();
        const locked = ['preparing', 'applying'].includes(phase);
        parts.close.disabled = locked;
        parts.body.replaceChildren();
        parts.foot.replaceChildren();

        const pane = ctEl('div', 'crack-so-pane crack-so-center crack-smart-loading');
        const orb = ctEl('div', 'crack-so-orb');
        orb.innerHTML = ctSparkIcon(28);
        const text = ctEl('div', 'crack-smart-progress-text', status);
        const bar = ctEl('div', 'crack-so-bar is-ind');
        bar.appendChild(document.createElement('i'));
        pane.append(orb, text, bar);
        parts.body.appendChild(pane);

        if (locked) {
            parts.foot.appendChild(makeSmartBusyButton('처리 중'));
        } else {
            const cancel = ctEl('button', 'crack-smart-button', '취소');
            cancel.type = 'button';
            cancel.addEventListener('click', () => closeSmartOrganize());
            parts.foot.appendChild(cancel);
        }
    }

    function renderSmartOrganizeApplying() {
        const root = getSmartOrganizeRoot();
        if (!root) return;

        setSmartSteps('applying');
        setSmartOrganizeHeader('보관함에 적용하는 중', '창을 닫지 말고 잠시만 기다려 주세요.');

        const parts = getSmartOrganizeParts();
        parts.close.disabled = true;
        parts.body.replaceChildren();
        parts.foot.replaceChildren();

        // applySmartOrganize와 같은 필터·순서라서 진행 번호와 줄 번호가 일치한다.
        const rows = smartOrganizeState.rows.filter(row => row.action === 'create' || row.action === 'merge');

        const pane = ctEl('div', 'crack-so-pane');
        const top = ctEl('div', 'crack-so-prog-top');
        top.append(
            ctEl('span', 'crack-smart-progress-text', smartOrganizeState.status || '보관함에 적용하는 중'),
            ctEl('b', 'crack-so-count', `0/${rows.length}`)
        );
        const bar = ctEl('div', 'crack-so-bar');
        bar.appendChild(document.createElement('i'));
        const list = ctEl('ul', 'crack-so-apply');
        rows.forEach(row => {
            const li = document.createElement('li');
            li.append(
                ctEl('span', 'crack-so-st'),
                ctEl('span', 'crack-so-ap-name', row.name || '이름 없는 보관함'),
                ctEl('span', 'crack-so-ap-act', row.action === 'merge' ? '기존에 합치기' : '새 보관함')
            );
            list.appendChild(li);
        });
        pane.append(top, bar, list);
        parts.body.appendChild(pane);

        parts.foot.append(ctEl('span', 'crack-smart-summary', '창을 닫지 말고 기다려 주세요'), makeSmartBusyButton('정리하는 중'));
    }

    function updateSmartOrganizeProgress(status) {
        smartOrganizeState.status = status;
        const root = getSmartOrganizeRoot();
        if (!root) return;

        // applySmartOrganize는 phase만 'applying'으로 바꾸고 화면은 그대로 두므로 여기서 전환한다.
        if (smartOrganizeState.phase === 'applying' && root.dataset.phase !== 'applying') {
            renderSmartOrganizeApplying();
        }

        const text = root.querySelector('.crack-smart-progress-text');
        if (text && text.textContent !== status) {
            text.textContent = status;

        }

        const match = /(\d+)\s*\/\s*(\d+)/.exec(String(status || ''));
        if (!match) return;

        const current = Number(match[1]);
        const total = Number(match[2]);
        if (!total) return;

        const applying = smartOrganizeState.phase === 'applying';
        const bar = root.querySelector('.crack-so-bar');
        if (bar) {
            bar.classList.remove('is-ind');
            const fill = bar.querySelector('i');
            // 적용 문구의 숫자는 "지금 시작한 항목" 번호라서 하나 덜 채운다.
            const done = applying ? current - 1 : current;
            if (fill) fill.style.width = `${Math.max(0, Math.min(100, (done / total) * 100))}%`;
        }

        if (!applying) return;

        const count = root.querySelector('.crack-so-count');
        if (count) count.textContent = `${current}/${total}`;

        const body = root.querySelector('.crack-smart-body');
        root.querySelectorAll('.crack-so-apply li').forEach((li, index) => {
            li.className = index < current - 1 ? 'is-done' : index === current - 1 ? 'is-now' : '';
            if (index === current - 1 && body && li.offsetTop + li.offsetHeight > body.scrollTop + body.clientHeight - 8) {
                body.scrollTop = li.offsetTop + li.offsetHeight - body.clientHeight + 16;
            }
        });
    }

    function formatSmartFolderDate(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
    }

    function getSmartOrganizeSummary() {
        const rows = smartOrganizeState.rows;
        const createRows = rows.filter(row => row.action === 'create');
        const mergeRows = rows.filter(row => row.action === 'merge');
        const skipRows = rows.filter(row => row.action === 'skip');
        return {
            createGroups: createRows.length,
            mergeGroups: mergeRows.length,
            skipGroups: skipRows.length,
            selectedGroups: createRows.length + mergeRows.length,
            selectedChats: [...createRows, ...mergeRows].reduce((sum, row) => sum + Math.max(0, Number(row.chatCount || 0)), 0)
        };
    }

    function updateSmartOrganizeReviewSummary(bump = false) {
        const root = getSmartOrganizeRoot();
        if (!root) return;

        const summary = getSmartOrganizeSummary();
        const text = root.querySelector('.crack-smart-summary');
        const apply = root.querySelector('[data-smart-action="apply"]');

        if (text) {
            text.textContent = summary.selectedGroups
                ? `그룹 ${summary.selectedGroups}개, 채팅 ${summary.selectedChats}개를 옮겨요`
                : '옮길 채팅이 없어요';
            text.title = `새로 만들기 ${summary.createGroups}개, 합치기 ${summary.mergeGroups}개, 건너뛰기 ${summary.skipGroups}개`;
            if (bump) {
                text.classList.remove('is-bump');
                void text.offsetWidth;
                text.classList.add('is-bump');
            }
        }
        if (apply) {
            apply.disabled = summary.selectedGroups === 0;
            apply.textContent = summary.selectedGroups ? `${summary.selectedGroups}개 그룹 정리` : '정리할 항목 없음';
        }
    }

    function makeSmartSelect(options, value) {
        const select = document.createElement('select');
        select.className = 'crack-smart-select';
        for (const optionInfo of options) {
            const option = document.createElement('option');
            option.value = optionInfo.value;
            option.textContent = optionInfo.label;
            select.appendChild(option);
        }
        select.value = value;
        return select;
    }

    function syncSmartReviewRow(rowEl, row) {
        rowEl.dataset.action = row.action;
        const seg = rowEl.querySelector('.crack-so-seg');
        const buttons = Array.from(seg?.querySelectorAll('button') || []);
        const index = Math.max(0, buttons.findIndex(button => button.dataset.value === row.action));
        seg?.style.setProperty('--i', String(index));
        buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.value === row.action)));
        rowEl.classList.toggle('is-target', row.action === 'merge' && row.existingMatches.length > 0);
    }

    const smartStoryImages = new Map();
    let searchResultsOpen = false;
    function rememberSmartStoryImages(chats) {
        for (const chat of chats) {
            const id = String(chat?.story?._id || '');
            const image = getBestImage(chat);
            if (id && image) smartStoryImages.set(id, image);
        }
    }
    function seedSmartStoryImages() {
        for (const item of archiveSearchState.items) {
            if (item?.storyId && item.imageUrl) smartStoryImages.set(String(item.storyId), item.imageUrl);
        }
        // Only currently mounted chat rows; no full-page image scan.
        for (const link of getChatContainers()) {
            const id = (link.getAttribute('href') || '').match(/\/stories\/([^/]+)\/episodes\//)?.[1];
            const image = link.querySelector('img');
            if (id && image?.src) smartStoryImages.set(id, image.currentSrc || image.src);
        }
    }
    function createSmartThumbnail(row) {
        const thumb = ctEl('span', 'crack-so-thumb');
        thumb.setAttribute('aria-hidden', 'true');
        const fallback = () => { thumb.innerHTML = CT_ICON.folder; };
        const url = smartStoryImages.get(String(row.storyId));
        if (!url) { fallback(); return thumb; }
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.addEventListener('error', fallback, { once: true });
        img.src = url;
        thumb.appendChild(img);
        return thumb;
    }

    function buildSmartReviewRow(row, index) {
        const hasMatches = row.existingMatches.length > 0;
        const rowEl = ctEl('div', 'crack-so-row');
        rowEl.dataset.conflict = hasMatches ? 'true' : 'false';
        rowEl.style.setProperty('--d', String(Math.min(index, 10)));

        const thumb = createSmartThumbnail(row);

        const main = ctEl('div', 'crack-so-row-main');
        const nameLine = ctEl('div', 'crack-so-name');
        nameLine.appendChild(ctEl('strong', '', row.name || '이름 없는 보관함'));
        if (row.isSingletonSupplement) nameLine.appendChild(ctEl('span', 'crack-so-tag', '단일 채팅'));
        const meta = ctEl('div', 'crack-so-meta', hasMatches
            ? `새 채팅 ${row.chatCount}개, 같은 이름 보관함 ${row.existingMatches.length}개`
            : `새 채팅 ${row.chatCount}개, 새 보관함으로`);
        main.append(nameLine, meta);

        const options = hasMatches
            ? [['merge', '합치기'], ['create', '새로 만들기'], ['skip', '건너뛰기']]
            : [['create', '새로 만들기'], ['skip', '건너뛰기']];
        const seg = ctEl('div', 'crack-so-seg');
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', '처리 방법');
        seg.style.setProperty('--n', String(options.length));
        seg.appendChild(ctEl('span', 'crack-so-seg-ind'));
        options.forEach(([value, label]) => {
            const button = ctEl('button', '', label);
            button.type = 'button';
            button.dataset.value = value;
            button.addEventListener('click', () => {
                if (row.action === value) return;
                row.action = value;
                syncSmartReviewRow(rowEl, row);
                updateSmartOrganizeReviewSummary(true);
            });
            seg.appendChild(button);
        });

        const target = ctEl('div', 'crack-so-target');
        const targetInner = document.createElement('div');
        if (hasMatches) {
            const label = ctEl('label', 'crack-so-tg');
            label.appendChild(ctEl('span', '', '합칠 보관함'));
            const targetOptions = row.existingMatches.map((folder, i) => {
                const date = formatSmartFolderDate(folder.createdAt);
                const pinned = folder.pinnedAt ? ', 고정됨' : '';
                return {
                    value: folder._id,
                    label: `기존 ${i + 1} (${Number(folder.chatCount || 0)}개${date ? ', ' + date : ''}${pinned})`
                };
            });
            if (targetOptions.length > 1) {
                const select = makeSmartSelect(targetOptions, row.targetFolderId || targetOptions[0].value);
                select.addEventListener('change', () => {
                    row.targetFolderId = select.value;
                });
                label.appendChild(select);
            } else {
                label.appendChild(ctEl('em', '', targetOptions[0].label));
            }
            targetInner.appendChild(label);
        }
        target.appendChild(targetInner);

        rowEl.append(thumb, main, seg, target);
        syncSmartReviewRow(rowEl, row);
        return rowEl;
    }

    function renderSmartOrganizeReview() {
        seedSmartStoryImages();
        smartOrganizeState.phase = 'review';
        smartOrganizeState.busy = false;
        setSmartSteps('review');
        setSmartOrganizeHeader('스마트 자동 정리', '같은 이름 보관함이 있으면 합치고, 없으면 새로 만들어요.');

        const parts = getSmartOrganizeParts();
        parts.close.disabled = false;
        parts.body.replaceChildren();
        parts.foot.replaceChildren();

        if (!smartOrganizeState.rows.length) {
            const empty = ctEl('div', 'crack-so-pane crack-so-center crack-smart-message');
            empty.appendChild(ctEl('h4', '', smartOrganizeState.singletonStatus === 'error'
                ? '순정 자동 정리 후보가 없습니다. 단일 채팅 확인도 실패했어요.'
                : '자동 정리할 채팅이 없습니다.'));
            if (smartOrganizeState.singletonStatus === 'error') {
                empty.appendChild(ctEl('p', 'crack-smart-error', `단일 채팅 확인 실패: ${smartOrganizeState.singletonError || '알 수 없는 오류'}`));
            }
            parts.body.appendChild(empty);

            const close = ctEl('button', 'crack-smart-button primary', '닫기');
            close.type = 'button';
            close.addEventListener('click', () => closeSmartOrganize());
            parts.foot.appendChild(close);
            return;
        }

        const pairs = [];
        const conflictCount = smartOrganizeState.rows.filter(row => row.existingMatches.length > 0).length;

        const pane = ctEl('div', 'crack-so-pane');
        const toolbar = ctEl('div', 'crack-so-tools');
        toolbar.appendChild(ctEl('span', 'crack-smart-chip', `정리 후보 ${smartOrganizeState.rows.length}개`));

        if (smartOrganizeState.singletonStatus === 'ready') {
            toolbar.appendChild(ctEl('span', 'crack-smart-chip', smartOrganizeState.singletonCount
                ? `단일 채팅 +${smartOrganizeState.singletonCount}개`
                : '단일 채팅 추가 없음'));
        } else if (smartOrganizeState.singletonStatus === 'error') {
            const chip = ctEl('span', 'crack-smart-chip conflict', '단일 채팅 확인 실패');
            chip.title = smartOrganizeState.singletonError || '';
            toolbar.appendChild(chip);
        }

        if (conflictCount) {
            toolbar.appendChild(ctEl('span', 'crack-smart-chip conflict', `이름 겹침 ${conflictCount}개`));
            toolbar.appendChild(ctEl('span', 'crack-so-grow'));

            const bulk = (action, label) => {
                const button = ctEl('button', 'crack-smart-button small', label);
                button.type = 'button';
                button.addEventListener('click', () => {
                    pairs.forEach(([rowEl, row]) => {
                        if (!row.existingMatches.length) return;
                        row.action = action;
                        syncSmartReviewRow(rowEl, row);
                    });
                    updateSmartOrganizeReviewSummary(true);
                });
                return button;
            };
            toolbar.append(bulk('merge', '겹치는 건 모두 합치기'), bulk('create', '모두 따로 만들기'));
        }

        const list = ctEl('div', 'crack-so-rows');
        smartOrganizeState.rows.forEach((row, index) => {
            const rowEl = buildSmartReviewRow(row, index);
            pairs.push([rowEl, row]);
            list.appendChild(rowEl);
        });

        const note = ctEl('p', 'crack-so-note', smartOrganizeState.singletonStatus === 'error'
            ? `이름은 띄어쓰기와 대소문자 차이를 무시하고 비교해요. 단일 채팅 확인은 실패해서 순정 후보만 보여줘요: ${smartOrganizeState.singletonError || '알 수 없는 오류'}`
            : '이름은 띄어쓰기와 대소문자 차이를 무시하고 비교해요. 보관함에 없는 1개짜리 채팅도 함께 찾았고, 정리 버튼을 누르기 전에는 아무것도 바뀌지 않아요.');

        pane.append(toolbar, list, note);
        parts.body.appendChild(pane);

        const summaryText = ctEl('span', 'crack-smart-summary');

        const cancel = ctEl('button', 'crack-smart-button', '취소');
        cancel.type = 'button';
        cancel.addEventListener('click', () => closeSmartOrganize());

        const apply = ctEl('button', 'crack-smart-button primary');
        apply.type = 'button';
        apply.dataset.smartAction = 'apply';
        apply.addEventListener('click', () => applySmartOrganize());

        parts.foot.append(summaryText, cancel, apply);
        updateSmartOrganizeReviewSummary();
    }

    function renderSmartOrganizeError(error, retry = true) {
        smartOrganizeState.phase = 'error';
        smartOrganizeState.busy = false;
        ensureSmartOrganizeModal();
        setSmartSteps('error');
        setSmartOrganizeHeader('스마트 자동 정리 실패', '아직 보관함 변경은 적용되지 않았습니다.');

        const parts = getSmartOrganizeParts();
        parts.close.disabled = false;
        parts.body.replaceChildren();
        parts.foot.replaceChildren();

        const pane = ctEl('div', 'crack-so-pane crack-so-center crack-smart-message');
        const mark = ctEl('div', 'crack-so-err');
        mark.innerHTML = CT_ICON.alert;
        pane.append(
            mark,
            ctEl('h4', '', '미리보기를 준비하지 못했어요.'),
            ctEl('p', 'crack-smart-error', getSmartOrganizeErrorMessage(error))
        );
        parts.body.appendChild(pane);

        const close = ctEl('button', 'crack-smart-button', '닫기');
        close.type = 'button';
        close.addEventListener('click', () => closeSmartOrganize());
        parts.foot.append(ctEl('span', 'crack-smart-summary'), close);

        if (retry) {
            const retryButton = ctEl('button', 'crack-smart-button primary', '다시 시도');
            retryButton.type = 'button';
            retryButton.addEventListener('click', () => {
                closeSmartOrganize(true);
                setTimeout(() => openSmartOrganize(), 50);
            });
            parts.foot.appendChild(retryButton);
        }
    }

    function renderSmartOrganizeDone(result) {
        smartOrganizeState.phase = 'done';
        smartOrganizeState.busy = false;
        smartOrganizeState.result = result;

        const failed = result.items.filter(item => !item.ok);
        setSmartSteps('done');
        setSmartOrganizeHeader(
            failed.length ? '스마트 자동 정리 일부 완료' : '스마트 자동 정리 완료',
            failed.length ? '성공한 항목은 적용됐고, 실패한 항목은 아래에 표시했어요.' : '선택한 채팅을 모두 안전하게 정리했어요.'
        );

        const parts = getSmartOrganizeParts();
        parts.close.disabled = false;
        parts.body.replaceChildren();
        parts.foot.replaceChildren();

        const pane = ctEl('div', 'crack-so-pane crack-so-center crack-smart-message');
        if (failed.length) {
            const mark = ctEl('div', 'crack-so-err');
            mark.innerHTML = CT_ICON.alert;
            pane.appendChild(mark);
        } else {
            const mark = document.createElement('div');
            mark.innerHTML = '<svg class="crack-so-check" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/><path d="M16 27l7 7 14-15"/></svg>';
            pane.appendChild(mark);
        }

        pane.appendChild(ctEl('h4', '', failed.length ? '일부만 정리했어요' : '정리를 마쳤어요'));
        pane.appendChild(ctEl('p', '', `새 보관함 ${result.createdGroups}개를 만들고 ${result.mergedGroups}개 그룹을 기존 보관함에 합쳤어요. 옮긴 채팅은 모두 ${result.movedChats}개예요.`));

        if (failed.length) {
            const list = ctEl('ul', 'crack-smart-result-list crack-smart-error');
            failed.forEach(item => list.appendChild(ctEl('li', '', `${item.name}: ${item.error}`)));
            pane.appendChild(list);
        } else {
            pane.appendChild(ctEl('p', 'crack-so-faint', '보관함 및 채팅 목록 개수도 자동으로 다시 계산합니다.'));
        }
        parts.body.appendChild(pane);

        const close = ctEl('button', 'crack-smart-button primary', '완료');
        close.type = 'button';
        close.addEventListener('click', () => closeSmartOrganize());
        parts.foot.append(ctEl('span', 'crack-smart-summary'), close);
    }

    function normalizeSmartFolderName(value) {
        return cleanText(value || '')
            .normalize('NFKC')
            .replace(/\s+/g, ' ')
            .trim()
            .toLocaleLowerCase();
    }

    function sortSmartExistingFolders(folders) {
        return [...folders].sort((a, b) => {
            const countDiff = Number(b?.chatCount || 0) - Number(a?.chatCount || 0);
            if (countDiff) return countDiff;
            return String(a?.createdAt || '').localeCompare(String(b?.createdAt || ''));
        });
    }

    function buildSmartOrganizeRows(groups, existingFolders) {
        const byName = new Map();
        for (const folder of existingFolders) {
            if (!folder?._id) continue;
            const key = normalizeSmartFolderName(folder.name);
            if (!key) continue;
            if (!byName.has(key)) byName.set(key, []);
            byName.get(key).push(folder);
        }

        return groups
            .filter(group => group?.storyId && Number(group?.chatCount || 0) > 0)
            .map(group => {
                const matches = sortSmartExistingFolders(byName.get(normalizeSmartFolderName(group.name)) || []);
                return {
                    storyId: group.storyId,
                    name: cleanText(group.name || '이름 없는 보관함'),
                    chatCount: Math.max(0, Number(group.chatCount || 0)),
                    preloadedChatIds: Array.isArray(group.preloadedChatIds)
                        ? [...new Set(group.preloadedChatIds.filter(Boolean))]
                        : null,
                    isSingletonSupplement: !!group.isSingletonSupplement,
                    existingMatches: matches,
                    action: matches.length ? 'merge' : 'create',
                    targetFolderId: matches[0]?._id || ''
                };
            });
    }

    function buildSmartSingletonGroups(rootChats, existingFolders, previewGroups) {
        const existingNames = new Set(
            existingFolders
                .filter(folder => folder?._id)
                .map(folder => normalizeSmartFolderName(folder.name))
                .filter(Boolean)
        );
        const previewStoryIds = new Set(
            previewGroups
                .map(group => String(group?.storyId || ''))
                .filter(Boolean)
        );
        const grouped = new Map();

        for (const chat of rootChats) {
            const chatId = String(chat?._id || '');
            const storyId = String(chat?.story?._id || '');
            if (!chatId || !storyId || previewStoryIds.has(storyId)) continue;

            const name = cleanText(chat?.story?.name || chat?.title || '');
            if (!name) continue;

            if (!grouped.has(storyId)) {
                grouped.set(storyId, {
                    storyId,
                    name,
                    chatIds: new Set()
                });
            }
            grouped.get(storyId).chatIds.add(chatId);
        }

        return [...grouped.values()]
            .filter(group => group.chatIds.size === 1)
            .filter(group => existingNames.has(normalizeSmartFolderName(group.name)))
            .map(group => ({
                storyId: group.storyId,
                name: group.name,
                chatCount: 1,
                preloadedChatIds: [...group.chatIds],
                isSingletonSupplement: true
            }));
    }

    function getSmartOrganizeErrorMessage(error) {
        if (error?.message === 'NO_AUTH_TOKEN') {
            return '인증 토큰을 아직 못 잡았어요. 채팅방을 아무거나 한 번 열었다 나온 뒤 다시 시도해 주세요.';
        }
        if (error?.status === 401) return '인증이 만료됐어요. 크랙을 새로고침한 뒤 다시 시도해 주세요.';
        return cleanText(error?.detail || error?.message || String(error || '알 수 없는 오류'));
    }

    async function openSmartOrganize() {
        if (smartOrganizeState.open) return;

        smartOrganizeState.runId += 1;
        const runId = smartOrganizeState.runId;
        smartOrganizeState.open = true;
        smartOrganizeState.busy = true;
        smartOrganizeState.previewId = '';
        smartOrganizeState.rows = [];
        smartOrganizeState.singletonStatus = 'idle';
        smartOrganizeState.singletonCount = 0;
        smartOrganizeState.singletonError = '';
        smartOrganizeState.result = null;

        ensureSmartOrganizeModal();
        renderSmartOrganizeLoading('스마트 자동 정리 준비', '인증 정보를 확인하는 중…', 'loading');

        try {
            if (!hasAuthToken()) await waitForAuthToken(6000);
            if (!isSmartOrganizeRunActive(runId)) return;
            if (!hasAuthToken()) throw new Error('NO_AUTH_TOKEN');

            updateSmartOrganizeProgress('크랙 자동 정리 미리보기를 만드는 중…');
            const previewJson = await requestCrackJson('/crack-gen/chat-folders/auto-organize/preview', {
                method: 'POST'
            });
            if (!isSmartOrganizeRunActive(runId)) return;

            const previewId = previewJson?.data?.previewId;
            if (!previewId) throw new Error('미리보기 ID를 받지 못했습니다.');
            smartOrganizeState.previewId = previewId;

            updateSmartOrganizeProgress('기존 보관함과 정리 후보를 비교하는 중…');
            const [existingFolders, groups] = await Promise.all([
                fetchSmartExistingFolders(),
                fetchSmartPreviewGroups(previewId)
            ]);
            if (!isSmartOrganizeRunActive(runId)) return;

            updateSmartOrganizeProgress('기존 보관함에 합칠 단일 채팅을 확인하는 중…');
            let singletonGroups = [];
            try {
                singletonGroups = await fetchSmartSingletonGroups(existingFolders, groups, (completed, total) => {
                    if (isSmartOrganizeRunActive(runId)) {
                        updateSmartOrganizeProgress(`보관함과 대조하는 중 ${completed}/${total}`);
                    }
                });
                smartOrganizeState.singletonStatus = 'ready';
                smartOrganizeState.singletonCount = singletonGroups.length;
            } catch (error) {
                // 보충 조회가 실패해도 순정 미리보기 기반 스마트 정리는 그대로 사용할 수 있게 둡니다.
                console.warn('[Crack UI] 단일 채팅 스마트 정리 후보 확인 실패:', error);
                smartOrganizeState.singletonStatus = 'error';
                smartOrganizeState.singletonCount = 0;
                smartOrganizeState.singletonError = getSmartOrganizeErrorMessage(error);
            }
            if (!isSmartOrganizeRunActive(runId)) return;

            smartOrganizeState.rows = buildSmartOrganizeRows([...groups, ...singletonGroups], existingFolders);
            renderSmartOrganizeReview();
        } catch (error) {
            if (!isSmartOrganizeRunActive(runId)) return;
            console.warn('[Crack UI] 스마트 자동 정리 준비 실패:', error);
            renderSmartOrganizeError(error, true);
        }
    }

    async function mapSmartWithConcurrency(items, limit, mapper, onProgress) {
        const results = new Array(items.length);
        let cursor = 0;
        let completed = 0;

        async function worker() {
            while (cursor < items.length) {
                const index = cursor++;
                results[index] = await mapper(items[index], index);
                completed += 1;
                onProgress?.(completed, items.length);
            }
        }

        const workers = Array.from(
            { length: Math.min(Math.max(1, limit), Math.max(1, items.length)) },
            () => worker()
        );
        await Promise.all(workers);
        return results;
    }

    async function applySmartOrganize() {
        if (smartOrganizeState.busy || smartOrganizeState.phase !== 'review') return;

        const selectedRows = smartOrganizeState.rows
            .filter(row => row.action === 'create' || row.action === 'merge')
            .map(row => ({ ...row }));
        if (!selectedRows.length) return;

        const runId = smartOrganizeState.runId;
        smartOrganizeState.busy = true;
        renderSmartOrganizeLoading('정리할 채팅 확인', `채팅 목록을 불러오는 중 0/${selectedRows.length}`, 'preparing');

        try {
            // 실제 변경 전에 모든 대상 채팅 ID를 먼저 확보한다. 중간 조회 실패로 반쯤 적용되는 일을 막는다.
            const prepared = await mapSmartWithConcurrency(
                selectedRows,
                SMART_ORGANIZE_LOAD_CONCURRENCY,
                async row => ({
                    row,
                    chatIds: row.preloadedChatIds?.length
                        ? [...row.preloadedChatIds]
                        : await fetchSmartPreviewChatIds(smartOrganizeState.previewId, row.storyId)
                }),
                (completed, total) => {
                    if (isSmartOrganizeRunActive(runId)) {
                        updateSmartOrganizeProgress(`채팅 목록을 불러오는 중 ${completed}/${total}`);
                    }
                }
            );
            if (!isSmartOrganizeRunActive(runId)) return;

            smartOrganizeState.phase = 'applying';
            const result = {
                createdGroups: 0,
                mergedGroups: 0,
                movedChats: 0,
                items: []
            };

            for (let index = 0; index < prepared.length; index += 1) {
                const { row, chatIds } = prepared[index];
                updateSmartOrganizeProgress(`보관함에 적용하는 중 ${index + 1}/${prepared.length} · ${row.name}`);

                try {
                    const uniqueChatIds = [...new Set(chatIds.filter(Boolean))];
                    if (!uniqueChatIds.length) {
                        result.items.push({ name: row.name, ok: true, action: 'skip-empty', chatCount: 0 });
                        continue;
                    }

                    if (row.action === 'merge') {
                        if (!row.targetFolderId) throw new Error('합칠 보관함을 선택하지 않았습니다.');
                        await moveSmartChatsToFolder(uniqueChatIds, row.targetFolderId);
                        result.mergedGroups += 1;
                    } else {
                        await createSmartFolderWithChats(row.name, uniqueChatIds);
                        result.createdGroups += 1;
                    }

                    result.movedChats += uniqueChatIds.length;
                    result.items.push({
                        name: row.name,
                        ok: true,
                        action: row.action,
                        chatCount: uniqueChatIds.length
                    });
                } catch (error) {
                    console.warn('[Crack UI] 스마트 자동 정리 항목 실패:', row.name, error);
                    result.items.push({
                        name: row.name,
                        ok: false,
                        action: row.action,
                        chatCount: 0,
                        error: getSmartOrganizeErrorMessage(error)
                    });
                }
            }

            archiveSearchState.refreshedThisPage = false;
            archiveSearchState.savedAt = 0;
            archiveSearchState.lastRenderKey = '';
            archiveSearchState.lastResultKey = '';
            markArchiveDataChanged();
            setTimeout(() => ensureArchiveSearchIndex(), 1200);
            renderSmartOrganizeDone(result);
        } catch (error) {
            if (!isSmartOrganizeRunActive(runId)) return;
            console.warn('[Crack UI] 스마트 자동 정리 적용 준비 실패:', error);
            renderSmartOrganizeError(error, true);
        }
    }

    function setupMarquee(container) {
        const nameSpan = container.querySelector(
            '.typo-text-sm_leading-none_medium, .text-popover-foreground.whitespace-nowrap, .text-popover-foreground'
        );

        if (!nameSpan || nameSpan.classList.contains('marquee-target')) return;

        nameSpan.classList.add('marquee-target');

        requestAnimationFrame(() => {
            const diff = nameSpan.scrollWidth - nameSpan.clientWidth;

            if (diff > 0) {
                nameSpan.classList.add('can-animate');
                nameSpan.style.setProperty('--move-dist', `${(diff + 10) * -1}px`);
            }
        });
    }

    // 보관함 상단 검색바 생성 및 삽입
    function scheduleSearchQueryApply(delay = SEARCH_DEBOUNCE_MS) {
        clearTimeout(searchDebounceTimer);

        searchDebounceTimer = setTimeout(() => {
            searchDebounceTimer = null;

            const input = document.querySelector('.crack-search-input');
            if (input && input.value !== currentSearchQueryRaw) {
                currentSearchQueryRaw = input.value || '';
            }

            filterChatsAndFolders(normalizeSearchText(currentSearchQueryRaw));
        }, delay);
    }

    function syncSearchInputFromState(input, clearBtn) {
        if (!input) return;

        const isNewInput = input !== lastSearchInputEl;
        lastSearchInputEl = input;

        if (isNewInput) {
            // React가 검색창을 새로 만든 경우에만 이전 검색어를 되살린다.
            // 조합(IME) 중에는 value를 건드리면 자모가 겹치므로 건너뛴다.
            if (!isSearchComposing && currentSearchQueryRaw && !input.value) {
                input.value = currentSearchQueryRaw;
            }
        } else if (!isSearchComposing) {
            // 살아있는 입력창에서는 입력창 값이 항상 진실이다.
            // 사용자가 직접 지웠으면 백업본도 같이 비워야 글자가 되살아나지 않는다.
            currentSearchQueryRaw = input.value || '';
        }

        if (clearBtn) {
            clearBtn.classList.toggle('visible', !!input.value.trim());
        }
    }

    function ensureSearchBarEvents(searchContainer) {
        if (!searchContainer) return;

        // 검색 결과는 fixed overlay에서만 렌더링합니다.
        searchContainer.querySelectorAll('.crack-api-result-snippet, .crack-api-search-status, .crack-api-search-results').forEach(el => el.remove());
        ensureSearchOverlay();

        const input = searchContainer.querySelector('.crack-search-input');
        const clearBtn = searchContainer.querySelector('.crack-search-clear');
        if (!input || !clearBtn) return;

        input.placeholder = includeRecentMessages ? '제목·최근 메시지 검색...' : '채팅방 제목 검색...';
        syncSearchInputFromState(input, clearBtn);

        if (searchContainer.dataset.crackSearchBound === 'true') return;

        input.addEventListener('compositionstart', () => {
            isSearchComposing = true;
        });

        input.addEventListener('compositionend', () => {
            isSearchComposing = false;
            currentSearchQueryRaw = input.value || '';
            const query = normalizeSearchText(currentSearchQueryRaw);
            clearBtn.classList.toggle('visible', !!query);
            scheduleSearchQueryApply(SEARCH_DEBOUNCE_MS);
        });

        // IME 조합 중에도 input.value 기준으로 검색을 갱신한다.
        input.addEventListener('input', () => {
            currentSearchQueryRaw = input.value || '';
            const query = normalizeSearchText(currentSearchQueryRaw);
            clearBtn.classList.toggle('visible', !!query);

            scheduleSearchQueryApply(SEARCH_DEBOUNCE_MS);
        });

        // 조합 중에 X를 누르면 포커스가 빠지면서 만들던 글자가 되돌아온다.
        // 클릭 전에 포커스가 빠지지 않도록 막는다.
        clearBtn.addEventListener('mousedown', e => {
            e.preventDefault();
        });

        clearBtn.addEventListener('click', () => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = null;
            isSearchComposing = false;

            currentSearchQueryRaw = '';
            input.value = '';
            clearBtn.classList.remove('visible');
            filterChatsAndFolders('');
            input.focus();

            // 뒤늦게 되돌아온 조합 문자를 한 번 더 정리한다.
            requestAnimationFrame(() => {
                if (currentSearchQueryRaw === '' && input.value) {
                    input.value = '';
                    clearBtn.classList.remove('visible');
                    filterChatsAndFolders('');
                }
            });
        });

        // 조합 입력/자동완성 직후에도 상태를 한 번 더 맞춘다.
        input.addEventListener('change', () => {
            currentSearchQueryRaw = input.value || '';
            clearBtn.classList.toggle('visible', !!normalizeSearchText(currentSearchQueryRaw));
            scheduleSearchQueryApply(SEARCH_DEBOUNCE_MS);
        });

        searchContainer.dataset.crackSearchBound = 'true';
    }


    function ensureSearchOverlay() {
        let overlay = document.getElementById('crack-search-overlay');
        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.id = 'crack-search-overlay';
        overlay.innerHTML = `
            <div class="crack-search-tools">
                <button type="button" class="crack-search-message-toggle" aria-pressed="${includeRecentMessages}" title="제목과 스토리명 외에 최근 메시지도 검색">최근 메시지 포함</button>
                <button type="button" class="crack-search-refresh" aria-label="검색 목록 새로고침" title="검색 목록 새로고침">↻</button>
            </div>
            <div class="crack-api-search-status"></div>
            <div class="crack-api-search-results"></div>
        `;
        const messageToggle = overlay.querySelector('.crack-search-message-toggle');
        messageToggle.addEventListener('mousedown', event => event.preventDefault());
        messageToggle.addEventListener('click', () => {
            includeRecentMessages = !includeRecentMessages;
            messageToggle.setAttribute('aria-pressed', String(includeRecentMessages));
            const input = document.querySelector('.crack-search-input');
            if (input) input.placeholder = includeRecentMessages ? '제목·최근 메시지 검색...' : '채팅방 제목 검색...';
            renderArchiveSearchResults(getCurrentSearchQuery());
        });
        const refreshButton = overlay.querySelector('.crack-search-refresh');
        refreshButton.addEventListener('mousedown', event => event.preventDefault());
        refreshButton.addEventListener('click', () => {
            if (archiveSearchState.inFlight) return;
            archiveSearchState.refreshedThisPage = false;
            archiveSearchState.savedAt = 0;
            ensureArchiveSearchIndex();
        });
        document.body.appendChild(overlay);
        return overlay;
    }

    function getSearchOverlayParts() {
        const overlay = ensureSearchOverlay();
        return {
            overlay,
            status: overlay.querySelector('.crack-api-search-status'),
            results: overlay.querySelector('.crack-api-search-results')
        };
    }

    function getSearchSidebarRect(searchContainer) {
        const searchRect = searchContainer.getBoundingClientRect();
        let best = null;

        for (let el = searchContainer.parentElement, depth = 0; el && el instanceof HTMLElement && el !== document.body && depth < 14; el = el.parentElement, depth += 1) {
            const rect = el.getBoundingClientRect();
            if (
                rect.width >= searchRect.width - 2 &&
                rect.width <= 430 &&
                rect.height >= 220 &&
                rect.left <= searchRect.left + 12 &&
                rect.right >= searchRect.right - 12
            ) {
                best = rect;
            }
        }

        if (best) return best;

        return {
            left: Math.max(0, searchRect.left - 10),
            right: searchRect.right + 10,
            width: searchRect.width + 20,
            top: searchRect.top,
            bottom: window.innerHeight,
            height: window.innerHeight - searchRect.top
        };
    }

    function updateSearchOverlayPosition() {
        const overlay = document.getElementById('crack-search-overlay');
        const searchContainer = document.querySelector('.crack-search-container');
        if (!overlay || !searchContainer || !overlay.classList.contains('visible')) return;

        const searchRect = searchContainer.getBoundingClientRect();
        const sidebarRect = getSearchSidebarRect(searchContainer);
        const top = Math.max(0, Math.round(searchRect.bottom + 6));
        const height = Math.max(120, Math.round(window.innerHeight - top));

        overlay.style.left = `${Math.max(0, Math.round(sidebarRect.left))}px`;
        overlay.style.top = `${top}px`;
        overlay.style.width = `${Math.max(180, Math.round(sidebarRect.width))}px`;
        overlay.style.height = `${height}px`;
    }

    function scheduleSearchOverlayPositionUpdate() {
        clearTimeout(searchOverlayPositionTimer);
        searchOverlayPositionTimer = setTimeout(() => {
            searchOverlayPositionTimer = null;
            updateSearchOverlayPosition();
        }, 30);
    }

    function setSearchOverlayActive(active) {
        searchResultsOpen = !!active;
        const overlay = ensureSearchOverlay();

        if (!active) {
            overlay.classList.remove('visible');
            return;
        }

        overlay.classList.add('visible');
        updateSearchOverlayPosition();
    }

    function isInsideSearchOverlay(node) {
        if (!node) return false;
        const el = node instanceof HTMLElement ? node : node.parentElement;
        return !!el?.closest?.('#crack-search-overlay');
    }

    function isInsideSmartOrganize(node) {
        if (!node) return false;
        const el = node instanceof HTMLElement ? node : node.parentElement;
        return !!el?.closest?.('#crack-smart-organize-modal');
    }

    // Radix 메뉴 포털의 생성·제거 및 팔레트 주입은 튜너 전체 UI 갱신 사유가 아니다.
    // 제거된 노드는 closest()가 동작하지 않을 수 있어 자기 자신/내부 role="menu"도 함께 확인한다.
    function isMenuLayerNode(node) {
        if (!(node instanceof HTMLElement)) return false;

        if (node.matches?.('[role="menu"]') || node.querySelector?.('[role="menu"]')) return true;
        if (node.closest?.('[role="menu"]')) return true;

        const popper = node.closest?.('[data-radix-popper-content-wrapper]');
        return !!popper?.querySelector?.('[role="menu"]');
    }

    function isMenuOnlyMutation(mutation) {
        if (!mutation) return false;
        if (isMenuLayerNode(mutation.target)) return true;

        const changedNodes = [
            ...Array.from(mutation.addedNodes || []),
            ...Array.from(mutation.removedNodes || [])
        ].filter(node => node instanceof HTMLElement);

        return changedNodes.length > 0 && changedNodes.every(isMenuLayerNode);
    }

    // 이전 버전에서 남긴 숨김/레이아웃 흔적을 정리합니다.
    function cleanupLegacySearchModeArtifacts(force = false) {
        // 구버전(v4.5.x 계열) 잔여 속성 정리는 대부분 최초 1회면 충분하다.
        // 검색어가 비어 있을 때마다 전역 querySelectorAll을 반복하지 않도록 막는다.
        if (!force && legacySearchCleanupDone) return;

        restoreSearchModeHiddenElements();
        restoreSearchLayoutExpansion();
        document.querySelectorAll('.crack-search-container.crack-search-active').forEach(el => {
            el.classList.remove('crack-search-active');
        });

        legacySearchCleanupDone = true;
    }

    function restoreSearchModeHiddenElements() {
        document.querySelectorAll('[data-crack-search-hidden-v457="true"]').forEach(el => {
            if (!(el instanceof HTMLElement)) return;
            const prev = el.dataset.crackPrevDisplayV457 || '';
            if (prev) {
                el.style.display = prev;
            } else {
                el.style.removeProperty('display');
            }
            delete el.dataset.crackSearchHiddenV457;
            delete el.dataset.crackPrevDisplayV457;
        });
    }

    function restoreSearchLayoutExpansion() {
        document.querySelectorAll('[data-crack-search-expanded-v458="true"]').forEach(el => {
            if (!(el instanceof HTMLElement)) return;

            const props = ['overflow', 'overflowY', 'overflowX', 'maxHeight', 'height', 'minHeight', 'flex', 'flexBasis'];
            props.forEach(prop => {
                const key = 'crackPrev' + prop.charAt(0).toUpperCase() + prop.slice(1) + '';
                const value = el.dataset[key] || '';
                if (value) {
                    el.style[prop] = value;
                } else {
                    el.style.removeProperty(prop.replace(/[A-Z]/g, m => '-' + m.toLowerCase()));
                }
                delete el.dataset[key];
            });

            delete el.dataset.crackSearchExpandedV458;
        });

        document.querySelectorAll('.crack-search-container.crack-search-active').forEach(el => {
            el.classList.remove('crack-search-active');
        });
    }

    const sectionHeaderCache = new Map();
    let tunerUiStarted = false;
    let countRetryAt = 0;
    let countFailures = 0;
    const pendingMenuInjections = new WeakSet();
    const OWN_TUNER_UI = '.crack-section-count, .crack-search-container, #crack-search-overlay, #crack-smart-organize-modal, .crack-so, #crack-lounge, #crack-local-folders, #crack-folder-results, #crack-folder-manager, #crack-local-assign, .custom-palette-container, .crack-smart-organize-menu-item, #crack-room-search, #crack-room-search-backdrop, #crack-room-search-launcher, #crack-room-search-toast, #crack-room-search-flash, .crs-bm-mark, #crk-hp-pill, #crk-hp-edit, #crk-hp-pop, #crk-hp-migrate, #crk-hp-toast, #crk-hp-lounge, #crk-hp-export, mark.crk-hl';
    const NON_LIST_CONTENT = '[data-message-group-id], .wrtn-markdown, .__chat_input_textarea, #cawf-root, #cawf-panel, #sgb-bg-root';

    function getListScope() {
        const archive = findArchiveHeaderSpan();
        const chats = findChatListHeaderSpan();
        const header = chats || archive;
        if (!header) return null;
        // Crack renders the heading and room rows as siblings inside this viewport.
        const viewport = header.closest('.scrollbar');
        if (viewport && (!archive || viewport.contains(archive))) return viewport;
        let scope = header.parentElement?.parentElement;
        while (scope && archive && !scope.contains(archive)) scope = scope.parentElement;
        while (scope && scope !== document.body && scope !== document.documentElement &&
            !scope.querySelector('a[href*="/episodes"], a[href*="/stories"]')) scope = scope.parentElement;
        if (scope === document.body || scope === document.documentElement) return null;
        return scope;
    }

    function nodeTouchesList(node) {
        if (!(node instanceof Element)) return false;
        if (node.closest(OWN_TUNER_UI + ', ' + NON_LIST_CONTENT)) return false;
        return node.matches('a[href*="/episodes"], a[href*="/stories"], button[aria-label="보관함 전체보기"]')
            || !!node.querySelector('a[href*="/episodes"], a[href*="/stories"], button[aria-label="보관함 전체보기"]');
    }

    function queueMenuInjection(menu) {
        if (pendingMenuInjections.has(menu)) return;
        pendingMenuInjections.add(menu);
        setTimeout(() => {
            pendingMenuInjections.delete(menu);
            if (!menu.isConnected) return;
            injectPalette(menu);
            injectSmartAutoOrganizeMenu(menu);
            rsInjectMessageMenu(menu);
        }, 0);
    }


    function findSectionHeaderSpan(label) {
        const cached = sectionHeaderCache.get(label);
        if (cached?.isConnected && cleanText(cached.textContent) === label && cached.getClientRects().length) return cached;
        const found = Array.from(document.querySelectorAll('span')).find(el => {
            if (cleanText(el.textContent) !== label) return false;
            if (el.closest('#crack-search-overlay, #crack-local-folders, #crack-folder-results, #crack-folder-manager, [data-message-group-id], .wrtn-markdown, .__chat_input_textarea')) return false;
            if (!el.getClientRects().length) return false;
            const dialog = el.closest('[role="dialog"]');
            if (dialog && (
                dialog.textContent.includes('보관함 이동') ||
                dialog.querySelector('h2')?.textContent?.includes('이동')
            )) return false;
            return isInActiveSidebar(el);
        }) || null;
        if (found) sectionHeaderCache.set(label, found);
        else sectionHeaderCache.delete(label);
        return found;
    }

    function findArchiveHeaderSpan() {
        return findSectionHeaderSpan('보관함');
    }

    function findChatListHeaderSpan() {
        return findSectionHeaderSpan('채팅 목록');
    }

    function findSectionHeaderRow(header) {
        if (!header) return null;

        for (let el = header.parentElement, depth = 0; el && el !== document.body && depth < 6; el = el.parentElement, depth += 1) {
            if (!(el instanceof HTMLElement)) continue;
            if (!el.classList.contains('flex') || !el.classList.contains('items-center')) continue;

            const text = cleanText(el.textContent);
            if (text.includes(cleanText(header.textContent))) return el;
        }

        return header.parentElement;
    }

    function placeSectionCountBadge(header, badge, kind) {
        let row = findSectionHeaderRow(header);
        if (!row) return false;

        if (kind === 'root') {
            // 채팅 목록 제목의 가장 가까운 flex가 내부 묶음일 수 있으므로,
            // 실제 점 세 개 메뉴 버튼을 포함한 상위 헤더 행까지 올라간다.
            let menuButton = null;
            for (let el = row; el && el !== document.body; el = el.parentElement) {
                if (!(el instanceof HTMLElement)) continue;
                const candidate = Array.from(el.querySelectorAll('button[aria-haspopup="menu"]'))
                    .find(button => button instanceof HTMLElement && isInActiveSidebar(button));
                if (!candidate) continue;
                row = el;
                menuButton = candidate;
                break;
            }

            if (menuButton) {
                let anchor = menuButton;
                while (anchor.parentElement && anchor.parentElement !== row) anchor = anchor.parentElement;
                if (anchor.parentElement !== row) return false;
                if (badge.parentElement !== row || badge.nextElementSibling !== anchor) row.insertBefore(badge, anchor);
                return true;
            }
        }

        // 보관함은 제목을 소유한 버튼/요소 바로 뒤에 둔다.
        const titleOwner = header.closest('button') || header;
        if (titleOwner.parentElement === row) {
            if (badge.parentElement !== row || badge.previousElementSibling !== titleOwner) {
                titleOwner.insertAdjacentElement('afterend', badge);
            }
        } else if (badge.parentElement !== row) {
            row.appendChild(badge);
        }

        return true;
    }

    function updateSectionCountBadge(kind, header, count) {
        if (!header) return null;

        const selector = `.crack-section-count[data-kind="${kind}"]`;
        let badge = document.querySelector(selector);

        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'crack-section-count';
            badge.dataset.kind = kind;
        }

        if (!placeSectionCountBadge(header, badge, kind)) return null;

        const state = archiveSearchState.countStatus;
        const hasCount = Number.isFinite(count);
        const nextState = hasCount ? 'ready' : state;
        const nextText = hasCount
            ? `${count.toLocaleString()}개`
            : state === 'error' ? '—' : '…';
        const label = kind === 'archive' ? '보관함 채팅' : '채팅 목록';
        const nextAria = hasCount
            ? `${label} ${count}개`
            : state === 'error' ? `${label} 개수를 불러오지 못함` : `${label} 개수 불러오는 중`;

        // 같은 값이면 DOM을 다시 쓰지 않는다. MutationObserver 재렌더 깜빡임을 줄인다.
        if (badge.textContent !== nextText) badge.textContent = nextText;
        if (badge.dataset.state !== nextState) badge.dataset.state = nextState;
        if (badge.getAttribute('aria-label') !== nextAria) badge.setAttribute('aria-label', nextAria);
        badge.title = nextAria;

        return badge;
    }

    function updateChatCountBadges() {
        const archiveHeader = findArchiveHeaderSpan();
        const rootHeader = findChatListHeaderSpan();

        updateSectionCountBadge('archive', archiveHeader, archiveSearchState.totalArchiveChats);
        updateSectionCountBadge('root', rootHeader, archiveSearchState.totalRootChats);
    }

    function injectSearchBar() {
        updateChatCountBadges();
        const existing = document.querySelector('.crack-search-container');
        if (existing) {
            ensureSearchBarEvents(existing);
            return;
        }

        // 보관함 검색바 생성 시 진짜 사이드바 헤더만 정밀 타겟팅
        const archiveHeader = findArchiveHeaderSpan();
        if (!archiveHeader) return;

        const headerDiv = archiveHeader.closest('.flex.items-center');
        if (headerDiv && headerDiv.parentNode) {
            const searchContainer = document.createElement('div');
            searchContainer.className = 'crack-search-container';
            searchContainer.innerHTML = `
                <div class="crack-search-box">
                    <span class="crack-search-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" width="14" height="14">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </span>
                    <input type="text" class="crack-search-input" aria-label="채팅방 제목 검색" placeholder="채팅방 제목 검색...">
                    <button type="button" class="crack-search-clear" aria-label="검색어 지우기">✕</button>
                </div>
                <button type="button" class="crack-lounge-btn" aria-label="한눈에 보기" title="한눈에 보기" aria-expanded="false">${CT_ICON.grid}</button>
            `;

            headerDiv.parentNode.insertBefore(searchContainer, headerDiv);
            ensureSearchBarEvents(searchContainer);
        }
    }
    // API 기반 보관함 내부 검색 인덱스 -----------------------------
    function normalizeSearchText(text) {
        return cleanText(text).toLowerCase();
    }

    function textMatchesQuery(text, query) {
        const normalizedText = normalizeSearchText(text);
        const terms = normalizeSearchText(query).split(' ').filter(Boolean);
        if (!terms.length) return false;
        return terms.every(term => normalizedText.includes(term));
    }

    function getBestImage(chat) {
        const profile = chat?.story?.profileImage || {};
        const portrait = chat?.story?.portraitImage || {};
        return portrait.w200 || profile.w200 || portrait.origin || profile.origin || '';
    }

    function formatArchiveDate(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';

        const diff = Date.now() - date.getTime();
        const day = 24 * 60 * 60 * 1000;

        if (diff >= 0 && diff < day) return '오늘';
        if (diff >= day && diff < 2 * day) return '어제';
        if (diff >= 2 * day && diff < 7 * day) return `${Math.floor(diff / day)}일 전`;

        return `${date.getMonth() + 1}월 ${date.getDate()}일`;
    }

    function buildChatHref(chat) {
        const storyId = chat?.story?._id;
        const chatId = chat?._id;
        if (!storyId || !chatId) return '';
        return `/stories/${storyId}/episodes/${chatId}`;
    }

    function mapArchiveChat(folder, chat, source = 'archive') {
        const href = buildChatHref(chat);
        if (!href) return null;

        const title = cleanText(chat?.title || chat?.story?.name || '제목 없음');
        const isRoot = source === 'root';

        return {
            source,
            folderId: isRoot ? '__root__' : (folder?._id || ''),
            folderName: isRoot ? '채팅 목록' : (folder?.name || '보관함'),
            chatId: chat?._id || '',
            storyId: chat?.story?._id || '',
            title,
            // 최근 메시지는 미리보기로만 표시하며 제목 검색 조건에는 포함하지 않는다.
            lastMessage: cleanText(chat?.lastMessage || ''),
            storyName: cleanText(chat?.story?.name || ''),
            updatedAt: chat?.messagedAt || chat?.updatedAt || chat?.pinnedAt || chat?.createdAt || '',
            imageUrl: getBestImage(chat),
            href
        };
    }

    function getNextCursor(data) {
        if (!data || typeof data !== 'object') return null;
        return data.nextCursor || data.cursor || data.next || data.pageInfo?.nextCursor || data.pagination?.nextCursor || null;
    }

    function makeApiUrl(path, params = {}) {
        const url = new URL(path, CRACK_API_BASE);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, value);
            }
        });
        return url.toString();
    }

    async function fetchCrackJson(path, params = {}) {
        return requestCrackJson(path, { params });
    }
    async function requestCrackJson(path, options = {}) {
        const method = String(options.method || 'GET').toUpperCase();
        const url = makeApiUrl(path, options.params || {});
        const hasBody = options.body !== undefined;
        const headers = { accept: 'application/json', ...getAuthHeaderOnly() };
        if (hasBody) headers['content-type'] = 'application/json';
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), method === 'GET' ? 20000 : 60000);
        try {
            const response = await fetch(url, {
                method, mode: 'cors', credentials: 'include', headers, signal: controller.signal,
                ...(hasBody ? { body: JSON.stringify(options.body) } : {})
            });
            let json = null;
            try { json = await response.json(); } catch {}
            if (!response.ok) {
                const error = new Error(`API ${response.status}: ${path}`);
                error.status = response.status;
                error.url = url;
                error.detail = json?.message || json?.error || '';
                throw error;
            }
            if (response.status === 204 && method !== 'GET') return { result: 'SUCCESS' };
            if (!json || typeof json !== 'object' || json.success === false || /^(?:FAIL|FAILED|FAILURE|ERROR)$/i.test(json.result || '')) {
                throw new Error(`API_INVALID_RESPONSE: ${path}`);
            }
            if (method === 'GET' && (
                (path === '/crack-gen/v3/chats' && !Array.isArray(json.data?.chats)) ||
                (path === '/crack-gen/chat-folders' && !Array.isArray(json.data?.folders))
            )) throw new Error(`API_INVALID_LIST: ${path}`);
            return json;
        } finally {
            clearTimeout(timeout);
        }
    }
    async function fetchSmartExistingFolders() {
        const folders = [];
        const seenPageCursors = new Set();
        let cursor = null;
        let page = 0;

        do {
            const params = { limit: API_PAGE_LIMIT };
            if (cursor) params.cursor = cursor;

            const json = await fetchCrackJson('/crack-gen/chat-folders', params);
            const data = json?.data || {};
            const list = Array.isArray(data.folders) ? data.folders : [];
            folders.push(...list.filter(folder => folder?._id));

            cursor = getNextCursor(data);
            if (cursor && seenPageCursors.has(String(cursor))) throw new Error('API_CURSOR_LOOP');
            if (cursor) seenPageCursors.add(String(cursor));
            page += 1;
        } while (cursor && page < 50);

        if (cursor) throw new Error('보관함 목록이 너무 많아 전부 불러오지 못했습니다.');
        return folders;
    }

    async function fetchSmartPreviewGroups(previewId) {
        const groups = [];
        const seenPageCursors = new Set();
        let cursor = null;
        let page = 0;

        do {
            const params = {
                previewId,
                limit: API_PAGE_LIMIT
            };
            if (cursor) params.cursor = cursor;

            const json = await fetchCrackJson('/crack-gen/chat-folders/auto-organize/preview', params);
            const data = json?.data || {};
            const list = Array.isArray(data.folders) ? data.folders : [];
            groups.push(...list);

            cursor = getNextCursor(data);
            if (cursor && seenPageCursors.has(String(cursor))) throw new Error('API_CURSOR_LOOP');
            if (cursor) seenPageCursors.add(String(cursor));
            page += 1;
        } while (cursor && page < 50);

        if (cursor) throw new Error('자동 정리 후보가 너무 많아 전부 불러오지 못했습니다.');
        return groups;
    }

    async function fetchSmartPreviewChatIds(previewId, storyId) {
        const chatIds = [];
        const seen = new Set();
        const seenPageCursors = new Set();
        let cursor = null;
        let page = 0;

        do {
            const params = {
                previewId,
                storyId,
                limit: API_PAGE_LIMIT
            };
            if (cursor) params.cursor = cursor;

            const json = await fetchCrackJson('/crack-gen/chat-folders/auto-organize/preview', params);
            const data = json?.data || {};
            const chats = Array.isArray(data.chats) ? data.chats : [];

            for (const chat of chats) {
                const chatId = chat?._id;
                if (!chatId || seen.has(chatId)) continue;
                seen.add(chatId);
                chatIds.push(chatId);
            }

            cursor = getNextCursor(data);
            if (cursor && seenPageCursors.has(String(cursor))) throw new Error('API_CURSOR_LOOP');
            if (cursor) seenPageCursors.add(String(cursor));
            page += 1;
        } while (cursor && page < 80);

        if (cursor) throw new Error('정리할 채팅을 전부 불러오지 못했습니다.');
        return chatIds;
    }

    async function fetchSmartAllChats() {
        const chats = [];
        const seen = new Set();
        const seenPageCursors = new Set();
        let cursor = null;
        let page = 0;

        do {
            const params = { limit: API_PAGE_LIMIT };
            if (cursor) params.cursor = cursor;

            const json = await fetchCrackJson('/crack-gen/v3/chats', params);
            const data = json?.data || {};
            const list = Array.isArray(data.chats) ? data.chats : [];

            for (const chat of list) {
                const chatId = chat?._id;
                if (!chatId || seen.has(chatId)) continue;
                seen.add(chatId);
                chats.push(chat);
            }

            cursor = getNextCursor(data);
            if (cursor && seenPageCursors.has(String(cursor))) throw new Error('API_CURSOR_LOOP');
            if (cursor) seenPageCursors.add(String(cursor));
            page += 1;
        } while (cursor && page < 80);

        if (cursor) throw new Error('전체 채팅을 전부 불러오지 못했습니다.');
        rememberSmartStoryImages(chats);
        return chats;
    }

    async function fetchSmartFolderChatIds(folder) {
        const chatIds = [];
        const seen = new Set();
        const seenPageCursors = new Set();
        let cursor = null;
        let page = 0;

        do {
            const params = {
                folderId: folder._id,
                limit: API_PAGE_LIMIT
            };
            if (cursor) params.cursor = cursor;

            const json = await fetchCrackJson('/crack-gen/v3/chats', params);
            const data = json?.data || {};
            const chats = Array.isArray(data.chats) ? data.chats : [];

            for (const chat of chats) {
                const chatId = chat?._id;
                if (!chatId || seen.has(chatId)) continue;
                seen.add(chatId);
                chatIds.push(chatId);
            }

            cursor = getNextCursor(data);
            if (cursor && seenPageCursors.has(String(cursor))) throw new Error('API_CURSOR_LOOP');
            if (cursor) seenPageCursors.add(String(cursor));
            page += 1;
        } while (cursor && page < 80);

        if (cursor) throw new Error(`${cleanText(folder?.name || '보관함')} 내부 채팅을 전부 불러오지 못했습니다.`);
        return chatIds;
    }

    async function fetchSmartArchivedChatIds(existingFolders, onProgress) {
        const folders = existingFolders.filter(folder => folder?._id);
        const pages = await mapSmartWithConcurrency(
            folders,
            SMART_ORGANIZE_LOAD_CONCURRENCY,
            folder => fetchSmartFolderChatIds(folder),
            onProgress
        );

        const archivedChatIds = new Set();
        pages.forEach(chatIds => chatIds.forEach(chatId => archivedChatIds.add(chatId)));
        return archivedChatIds;
    }

    async function fetchSmartRootChats(existingFolders, onProgress) {
        // folderId 없는 호출은 보관함 채팅까지 포함한 전체 목록이다.
        // 모든 실제 보관함의 chatId를 빼면 순정 자동 정리와 무관한 미보관 목록만 남는다.
        const [allChats, archivedChatIds] = await Promise.all([
            fetchSmartAllChats(),
            fetchSmartArchivedChatIds(existingFolders, onProgress)
        ]);
        return allChats.filter(chat => chat?._id && !archivedChatIds.has(chat._id));
    }

    async function fetchSmartSingletonGroups(existingFolders, previewGroups, onProgress) {
        const rootChats = await fetchSmartRootChats(existingFolders, onProgress);
        if (!rootChats.length) return [];
        return buildSmartSingletonGroups(rootChats, existingFolders, previewGroups);
    }

    async function moveSmartChatsToFolder(chatIds, targetFolderId) {
        return requestCrackJson('/crack-gen/chat-folders/chats/move', {
            method: 'PATCH',
            body: {
                chatIds,
                targetFolderId
            }
        });
    }

    async function createSmartFolderWithChats(name, chatIds) {
        return requestCrackJson('/crack-gen/chat-folders', {
            method: 'POST',
            body: {
                name,
                chatIds
            }
        });
    }

    function loadArchiveSearchCache() {
        try {
            const raw = localStorage.getItem(ARCHIVE_SEARCH_CACHE_KEY);
            if (!raw) return false;

            const cached = JSON.parse(raw);
            if (!cached || !Array.isArray(cached.items)) return false;

            archiveSearchState.items = cached.items;
            archiveSearchState.savedAt = Number(cached.savedAt || 0);
            archiveSearchState.loadedChats = archiveSearchState.items.length;
            archiveSearchState.partial = !!cached.partial;
            // v1.0.15 이전 캐시는 totalRootChats에 전체 채팅 수가 들어 있어 재사용하면 안 된다.
            if (cached.countMode === 'root-minus-archive-v1') {
                const cachedArchiveCount = Number(cached.totalArchiveChats);
                const cachedRootCount = Number(cached.totalRootChats);
                const cachedAllCount = Number(cached.totalAllChats);
                if (Number.isFinite(cachedArchiveCount) && cachedArchiveCount >= 0) archiveSearchState.totalArchiveChats = cachedArchiveCount;
                if (Number.isFinite(cachedRootCount) && cachedRootCount >= 0) archiveSearchState.totalRootChats = cachedRootCount;
                if (Number.isFinite(cachedAllCount) && cachedAllCount >= 0) archiveSearchState.totalAllChats = cachedAllCount;
                if (Number.isFinite(archiveSearchState.totalArchiveChats) && Number.isFinite(archiveSearchState.totalRootChats)) {
                    archiveSearchState.countStatus = 'ready';
                }
            }
            archiveSearchState.status = 'ready';
            updateChatCountBadges();

            return true;
        } catch (error) {
            console.warn('[Crack UI] 보관함 검색 캐시 읽기 실패:', error);
            return false;
        }
    }

    function isArchiveSearchCacheFresh() {
        return archiveSearchState.items.length > 0 &&
            archiveSearchState.savedAt > 0 &&
            Date.now() - archiveSearchState.savedAt < ARCHIVE_SEARCH_CACHE_TTL;
    }

    function saveArchiveSearchCache() {
        try {
            localStorage.setItem(ARCHIVE_SEARCH_CACHE_KEY, JSON.stringify({
                savedAt: Date.now(),
                partial: archiveSearchState.partial,
                countMode: 'root-minus-archive-v1',
                totalArchiveChats: archiveSearchState.totalArchiveChats,
                totalRootChats: archiveSearchState.totalRootChats,
                totalAllChats: archiveSearchState.totalAllChats,
                items: archiveSearchState.items
            }));
        } catch (error) {
            console.warn('[Crack UI] 보관함 검색 캐시 저장 실패:', error);
        }
    }

    let archiveFoldersInFlight = null;

    let rootChatsInFlight = null;
    async function fetchRootChats() {
        if (rootChatsInFlight) return rootChatsInFlight;
        rootChatsInFlight = fetchRootChatsUnshared();
        try { return await rootChatsInFlight; }
        finally { rootChatsInFlight = null; }
    }

    async function fetchRootChatsUnshared() {
        const items = [];
        const seen = new Set();
        const seenPageCursors = new Set();
        let cursor = null;
        let page = 0;
        let truncated = false;

        do {
            const params = { limit: API_PAGE_LIMIT };
            if (cursor) params.cursor = cursor;

            const json = await fetchCrackJson('/crack-gen/v3/chats', params);
            const data = json?.data || {};
            const chats = Array.isArray(data.chats) ? data.chats : [];

            for (const chat of chats) {
                const mapped = mapArchiveChat(null, chat, 'root');
                if (!mapped || seen.has(mapped.chatId)) continue;
                seen.add(mapped.chatId);
                items.push(mapped);
                if (items.length >= MAX_ARCHIVE_CHATS) {
                    truncated = true;
                    break;
                }
            }

            cursor = getNextCursor(data);
            if (cursor && seenPageCursors.has(String(cursor))) throw new Error('API_CURSOR_LOOP');
            if (cursor) seenPageCursors.add(String(cursor));
            page += 1;
        } while (cursor && page < 80 && !truncated);

        return {
            items,
            totalCount: items.length,
            truncated: truncated || !!cursor
        };
    }

    async function fetchAllFolders() {
        if (archiveFoldersInFlight) return archiveFoldersInFlight;

        archiveFoldersInFlight = (async () => {
            const folders = [];
            const seenPageCursors = new Set();
            let cursor = null;
            let page = 0;
            let truncated = false;
            let totalChatCount = 0;

            do {
                const params = { limit: API_PAGE_LIMIT };
                if (cursor) params.cursor = cursor;

                const json = await fetchCrackJson('/crack-gen/chat-folders', params);
                const data = json?.data || {};
                const list = Array.isArray(data.folders) ? data.folders : [];

                // 검색 인덱스에 쓸 폴더는 기존 제한까지만 보관하되,
                // 전체 채팅 수는 모든 페이지의 chatCount를 끝까지 합산한다.
                totalChatCount += list.reduce(
                    (sum, folder) => sum + Math.max(0, Number(folder?.chatCount || 0)),
                    0
                );

                if (folders.length + list.length > MAX_ARCHIVE_FOLDERS) truncated = true;
                if (folders.length < MAX_ARCHIVE_FOLDERS) {
                    folders.push(...list.slice(0, MAX_ARCHIVE_FOLDERS - folders.length));
                }

                cursor = getNextCursor(data);
                if (cursor && seenPageCursors.has(String(cursor))) throw new Error('API_CURSOR_LOOP');
                if (cursor) seenPageCursors.add(String(cursor));
                page += 1;

                if (folders.length >= MAX_ARCHIVE_FOLDERS && cursor) {
                    truncated = true;
                }
            } while (cursor && page < 30);

            if (cursor) truncated = true;

            return {
                folders,
                totalChatCount,
                countComplete: !cursor,
                truncated
            };
        })();

        try {
            return await archiveFoldersInFlight;
        } finally {
            archiveFoldersInFlight = null;
        }
    }

    async function ensureArchiveCount(force = false) {
        if (document.hidden || !getListScope() || Date.now() < countRetryAt) return;
        if (archiveSearchState.countStatus === 'loading') {
            // 이동 직전 시작된 집계가 낡은 값으로 끝나더라도, 완료 직후 반드시 한 번 더 읽는다.
            if (force) archiveCountRefreshPending = true;
            return;
        }

        const fresh = archiveSearchState.countUpdatedAt && Date.now() - archiveSearchState.countUpdatedAt < 60000;
        const hasBothCounts = Number.isFinite(archiveSearchState.totalArchiveChats) && Number.isFinite(archiveSearchState.totalRootChats);
        if (!force && fresh && hasBothCounts) return;

        archiveSearchState.countStatus = 'loading';
        // 이미 확인된 숫자는 지우지 않는다. 재수집 중에도 기존 배지가 그대로 남는다.
        try {
            updateChatCountBadges();
            if (!hasAuthToken()) await waitForAuthToken(6000);
            if (!hasAuthToken()) throw new Error('NO_AUTH_TOKEN');

            const [folderResult, rootResult] = await Promise.all([
                fetchAllFolders(),
                fetchRootChats()
            ]);

            // 폴더 조건 없는 /v3/chats 응답은 보관함까지 포함한 전체 목록이다.
            // 따라서 화면의 "채팅 목록" 숫자는 전체에서 보관함 합계를 빼서 분리한다.
            if (rootResult.truncated || !folderResult.countComplete) throw new Error('COUNT_INCOMPLETE');
            const totalAllChats = Math.max(0, Number(rootResult.totalCount || 0));
            const totalArchiveChats = Math.max(0, Number(folderResult.totalChatCount || 0));
            archiveSearchState.totalArchiveChats = totalArchiveChats;
            archiveSearchState.totalRootChats = Math.max(0, totalAllChats - totalArchiveChats);
            archiveSearchState.totalAllChats = totalAllChats;
            archiveSearchState.countUpdatedAt = Date.now();
            archiveSearchState.countStatus = 'ready';
            countFailures = 0;
            countRetryAt = 0;
            saveArchiveSearchCache();
        } catch (error) {
            countFailures += 1;
            countRetryAt = Date.now() + Math.min(300000, 30000 * 2 ** Math.min(countFailures - 1, 4));
            const hasCachedCount = Number.isFinite(archiveSearchState.totalArchiveChats) || Number.isFinite(archiveSearchState.totalRootChats);
            archiveSearchState.countStatus = hasCachedCount ? 'ready' : 'error';
            console.warn('[Crack UI] 채팅 영역별 개수 로딩 실패:', error);
        } finally {
            updateChatCountBadges();

            if (archiveCountRefreshPending) {
                archiveCountRefreshPending = false;
                setTimeout(() => ensureArchiveCount(true), 250);
            }
        }
    }

    async function fetchFolderChats(folder) {
        const items = [];
        const seenPageCursors = new Set();
        let cursor = null;
        let page = 0;
        let truncated = false;

        do {
            if (archiveSearchState.loadedChats + items.length >= MAX_ARCHIVE_CHATS) {
                truncated = true;
                break;
            }

            const params = {
                folderId: folder._id,
                limit: API_PAGE_LIMIT
            };
            if (cursor) params.cursor = cursor;

            const json = await fetchCrackJson('/crack-gen/v3/chats', params);
            const data = json?.data || {};
            const chats = Array.isArray(data.chats) ? data.chats : [];

            for (const chat of chats) {
                const mapped = mapArchiveChat(folder, chat, 'archive');
                if (mapped) items.push(mapped);

                if (archiveSearchState.loadedChats + items.length >= MAX_ARCHIVE_CHATS) {
                    truncated = true;
                    break;
                }
            }

            cursor = getNextCursor(data);
            if (cursor && seenPageCursors.has(String(cursor))) throw new Error('API_CURSOR_LOOP');
            if (cursor) seenPageCursors.add(String(cursor));
            page += 1;
        } while (cursor && page < 80 && !truncated);

        return {
            items,
            truncated: truncated || !!cursor
        };
    }

    async function buildArchiveSearchIndex() {
        // 이미 화면에 쓸 수 있는 목록이 있으면, 재인덱싱 도중에는 items를 갈아끼우지 않는다.
        // 중간중간 교체하면 검색 결과 카드가 사라졌다 나타나며 깜빡인다.
        const keepExistingUntilDone = archiveSearchState.items.length > 0;

        archiveSearchState.status = 'indexing';
        archiveSearchState.started = true;
        archiveSearchState.lastError = '';
        archiveSearchState.loadedFolders = 0;
        archiveSearchState.totalFolders = 0;
        archiveSearchState.loadedChats = archiveSearchState.items.length;
        archiveSearchState.partial = false;
        archiveSearchState.lastRenderKey = '';
        scheduleArchiveSearchRender();

        if (!hasAuthToken()) await waitForAuthToken(6000);

        if (!hasAuthToken()) {
            const error = new Error('NO_AUTH_TOKEN');
            error.status = 401;
            throw error;
        }

        const allItems = [];
        let totalAllChatsFromRoot = null;

        // 폴더 조건 없는 일반 호출은 보관함까지 포함한 전체 채팅을 반환한다.
        // 검색 인덱스에는 그대로 넣되, 표시용 채팅 목록 개수는 폴더 합계를 받은 뒤 계산한다.
        try {
            const rootResult = await fetchRootChats();
            allItems.push(...rootResult.items);
            archiveSearchState.partial = archiveSearchState.partial || rootResult.truncated;
            totalAllChatsFromRoot = Math.max(0, Number(rootResult.totalCount || 0));
            archiveSearchState.loadedChats = Math.min(allItems.length, MAX_ARCHIVE_CHATS);

            if (!keepExistingUntilDone) {
                archiveSearchState.items = allItems.slice(0, MAX_ARCHIVE_CHATS);
                archiveSearchState.lastRenderKey = '';
            }
            scheduleArchiveSearchRender();
        } catch (error) {
            if ([401, 403, 429].includes(error?.status)) throw error;
            archiveSearchState.partial = true;
            console.warn('[Crack UI] 일반 채팅 목록 로딩 실패:', error);
        }

        // 보관함 목록 및 내부 채팅 인덱싱
        const folderResult = await fetchAllFolders();
        const folders = folderResult.folders.filter(folder => folder && folder._id && Number(folder.chatCount || 0) > 0);

        const totalArchiveChats = Math.max(0, Number(folderResult.totalChatCount || 0));
        const totalAllChats = Number.isFinite(totalAllChatsFromRoot)
            ? totalAllChatsFromRoot
            : Math.max(0, Number(archiveSearchState.totalAllChats || 0));
        if (Number.isFinite(totalAllChatsFromRoot) && !archiveSearchState.partial && folderResult.countComplete) {
        archiveSearchState.totalArchiveChats = totalArchiveChats;
        archiveSearchState.totalRootChats = Math.max(0, totalAllChats - totalArchiveChats);
        archiveSearchState.totalAllChats = totalAllChats;
        archiveSearchState.countUpdatedAt = Date.now();
        archiveSearchState.countStatus = 'ready';
        updateChatCountBadges();
        }

        archiveSearchState.totalFolders = folders.length;
        archiveSearchState.partial = archiveSearchState.partial || folderResult.truncated;
        archiveSearchState.loadedFolders = 0;
        archiveSearchState.lastRenderKey = '';
        scheduleArchiveSearchRender();

        let cursor = 0;

        async function worker() {
            while (cursor < folders.length && allItems.length < MAX_ARCHIVE_CHATS) {
                const folder = folders[cursor++];

                try {
                    const result = await fetchFolderChats(folder);
                    allItems.push(...result.items);
                    archiveSearchState.partial = archiveSearchState.partial || result.truncated;
                } catch (error) {
                    if ([401, 403, 429].includes(error?.status)) throw error;
                    archiveSearchState.partial = true;
                    console.warn('[Crack UI] 보관함 내부 채팅 로딩 실패:', folder?.name, error);
                } finally {
                    archiveSearchState.loadedFolders += 1;
                    archiveSearchState.loadedChats = Math.min(allItems.length, MAX_ARCHIVE_CHATS);

                    if (!keepExistingUntilDone) {
                        archiveSearchState.items = allItems.slice(0, MAX_ARCHIVE_CHATS);
                        archiveSearchState.lastRenderKey = '';
                    }

                    scheduleArchiveSearchRender();
                    await delay(40);
                }
            }
        }

        const workers = Array.from({ length: Math.min(API_CONCURRENCY, Math.max(1, folders.length)) }, () => worker());
        await Promise.all(workers);

        // 같은 채팅이 여러 경로로 잡혔을 때 중복 제거.
        // 같은 chatId가 일반 목록과 보관함 내부에 모두 있으면 보관함 내부 쪽을 우선한다.
        const unique = new Map();
        for (const item of allItems) {
            const prev = unique.get(item.chatId);
            if (!prev || (prev.source === 'root' && item.source === 'archive')) {
                unique.set(item.chatId, item);
            }
        }

        archiveSearchState.items = Array.from(unique.values()).slice(0, MAX_ARCHIVE_CHATS);
        archiveSearchState.loadedChats = archiveSearchState.items.length;
        archiveSearchState.status = 'ready';
        archiveSearchState.refreshedThisPage = true;
        archiveSearchState.savedAt = Date.now();
        archiveSearchState.inFlight = null;
        archiveSearchState.lastRenderKey = '';
        saveArchiveSearchCache();
        scheduleArchiveSearchRender();
        if (localFolderView !== LOCAL_ROOT_ID) renderLocalFolderBar();

        return archiveSearchState.items;
    }

    function ensureArchiveSearchIndex() {
        // 캐시가 있어도 페이지당 한 번은 뒤에서 새로 긁어온다.
        if (isArchiveSearchCacheFresh() && archiveSearchState.refreshedThisPage) {
            return Promise.resolve(archiveSearchState.items);
        }
        if (archiveSearchState.inFlight) return archiveSearchState.inFlight;

        // 인덱싱이 실패한 직후에는 잠깐 쉬어간다.
        // 실패할 때마다 글자 하나 칠 때마다 전체 재수집이 돌면서 결과가 깜빡이는 문제를 막는다.
        if (archiveSearchState.lastFailedAt && Date.now() - archiveSearchState.lastFailedAt < 15000) {
            return Promise.resolve(archiveSearchState.items);
        }

        const hadFreshCache = isArchiveSearchCacheFresh();

        archiveSearchState.inFlight = buildArchiveSearchIndex().then(items => {
            archiveSearchState.refreshedThisPage = true;
            archiveSearchState.lastFailedAt = 0;
            return items;
        }).catch(error => {
            archiveSearchState.status = archiveSearchState.items.length ? 'ready' : 'error';
            archiveSearchState.lastFailedAt = Date.now();

            if (error?.message === 'NO_AUTH_TOKEN') {
                archiveSearchState.lastError = '인증 토큰을 아직 못 잡았어. 채팅방을 아무거나 한 번 열었다 나오면 검색이 켜져.';
            } else if (error?.status === 401) {
                archiveSearchState.lastError = '인증 토큰이 거절됐어. 새로고침 후 채팅방을 한 번 열고 다시 검색해줘.';
            } else {
                archiveSearchState.lastError = String(error?.message || error);
            }

            archiveSearchState.inFlight = null;
            archiveSearchState.lastRenderKey = '';
            console.warn('[Crack UI] 보관함 검색 인덱싱 실패:', error);
            scheduleArchiveSearchRender();
            return archiveSearchState.items;
        });

        // 신선한 캐시가 있으면 기존 결과는 바로 보여주고, 새 인덱싱은 뒤에서 갱신한다.
        if (hadFreshCache) return Promise.resolve(archiveSearchState.items);
        return archiveSearchState.inFlight;
    }

    function getCurrentSearchQuery() {
        const input = document.querySelector('.crack-search-input');

        // 여기서는 절대 input.value를 되돌려 쓰지 않는다. 복구는 syncSearchInputFromState 전담.
        if (input && !isSearchComposing && input === lastSearchInputEl) {
            currentSearchQueryRaw = input.value || '';
        }

        return normalizeSearchText(currentSearchQueryRaw);
    }

    function scheduleArchiveSearchRender() {
        if (archiveSearchRenderRaf) return;

        archiveSearchRenderRaf = requestAnimationFrame(() => {
            archiveSearchRenderRaf = 0;
            renderArchiveSearchResults(getCurrentSearchQuery());
        });
    }

    function getArchiveSearchMatches(query) {
        if (!query) return [];

        const matches = [];
        const seen = new Set();

        for (const item of archiveSearchState.items) {
            if (!item || seen.has(item.chatId)) continue;

            // 기본 검색은 제목 + 스토리명. 선택한 경우에만 이미 인덱싱한 최근 메시지를 포함합니다.
            const haystack = includeRecentMessages
                ? `${item.title || ''} ${item.storyName || ''} ${item.lastMessage || ''}`
                : `${item.title || ''} ${item.storyName || ''}`;
            if (textMatchesQuery(haystack, query)) {
                seen.add(item.chatId);
                matches.push(item);
                if (matches.length >= MAX_ARCHIVE_RESULTS) break;
            }
        }

        return matches;
    }

    // 상태 문구가 인덱싱 진행에 맞춰 0.1초마다 바뀌면 글자 길이가 계속 달라져 깜빡이는 것처럼 보인다.
    // 같은 문구는 무시하고, 갱신도 최소 간격을 둔다.
    const STATUS_UPDATE_MIN_INTERVAL = 600;
    let lastStatusText = '';
    let lastStatusAt = 0;
    let statusPendingTimer = null;

    function setStatusText(message, visible = true) {
        const { status } = getSearchOverlayParts();
        if (!status) return;

        const text = message || '';

        const apply = () => {
            statusPendingTimer = null;
            lastStatusText = text;
            lastStatusAt = Date.now();
            status.textContent = text;
            status.classList.toggle('visible', !!visible && !!text);
        };

        // 검색어를 지운 경우(빈 문구)는 즉시 반영한다.
        if (!text) {
            clearTimeout(statusPendingTimer);
            statusPendingTimer = null;
            apply();
            return;
        }

        if (text === lastStatusText) {
            status.classList.toggle('visible', !!visible);
            return;
        }

        const remain = STATUS_UPDATE_MIN_INTERVAL - (Date.now() - lastStatusAt);
        clearTimeout(statusPendingTimer);

        if (remain <= 0) {
            apply();
        } else {
            statusPendingTimer = setTimeout(apply, remain);
        }
    }

    function renderArchiveSearchResults(query) {
        const { overlay, results: resultsBox, status: statusBox } = getSearchOverlayParts();
        if (!overlay || !resultsBox || !statusBox) return;

        const normalizedQuery = normalizeSearchText(query);

        if (!normalizedQuery) {
            archiveSearchState.lastRenderKey = '';
            archiveSearchState.lastResultKey = '';
            resultsBox.classList.remove('visible');
            resultsBox.replaceChildren();
            setStatusText('', false);
            setSearchOverlayActive(false);
            cleanupLegacySearchModeArtifacts();
            return;
        }

        setSearchOverlayActive(true);
        const refreshButton = overlay.querySelector('.crack-search-refresh');
        if (refreshButton) refreshButton.disabled = archiveSearchState.status === 'indexing';

        const matches = getArchiveSearchMatches(normalizedQuery);
        const rootMatches = matches.filter(item => item.source === 'root');
        const archiveMatches = matches.filter(item => item.source !== 'root');

        // 상태 문구는 매 렌더마다 갱신하되, 결과 카드 DOM 재생성 조건과 분리한다.
        // 인덱싱 진행 숫자만 바뀔 때 카드 전체가 replaceChildren() 되며 깜빡이는 문제를 막기 위함.
        let statusText = '';
        if (archiveSearchState.status === 'indexing') {
            // 진행 숫자를 실시간으로 찍지 않는다. 문구가 고정되어야 깜빡임이 없다.
            statusText = archiveSearchState.items.length
                ? '검색 결과 갱신 중'
                : '검색 목록 준비 중';
        } else if (archiveSearchState.status === 'ready') {
            const suffix = archiveSearchState.partial ? ' · 최대 수집 한도 적용' : '';
            statusText = `${archiveSearchState.loadedChats.toLocaleString()}개 채팅에서 검색${suffix}`;
        } else if (archiveSearchState.status === 'error') {
            statusText = archiveSearchState.items.length
                ? `${archiveSearchState.loadedChats.toLocaleString()}개 캐시에서 검색 · 최신화 실패`
                : `검색 준비 실패: ${archiveSearchState.lastError || '알 수 없는 오류'}`;
        } else {
            statusText = '검색 목록 준비 중';
        }

        setStatusText(statusText, true);

        // 결과 카드는 실제 매치 목록이 바뀔 때만 다시 그린다.
        // loadedFolders/loadedChats 같은 진행 상태는 resultKey에 넣지 않는다.
        const resultKey = JSON.stringify([normalizedQuery, includeRecentMessages, matches.map(item => [item.source, item.chatId, item.title, item.lastMessage, item.imageUrl, item.folderName, item.updatedAt])]);
        if (archiveSearchState.lastResultKey === resultKey) return;
        archiveSearchState.lastResultKey = resultKey;

        resultsBox.replaceChildren();

        if (matches.length === 0) {
            resultsBox.classList.remove('visible');
            return;
        }

        function appendGroup(label, items) {
            if (!items.length) return;

            const header = document.createElement('div');
            header.className = 'crack-api-result-header';
            header.textContent = `${label} ${items.length}개`;
            resultsBox.appendChild(header);

            items.forEach(item => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'crack-api-result-item';
                btn.title = `${item.folderName} / ${item.title}`;
                btn.addEventListener('click', () => {
                    if (item.href) location.href = item.href;
                });

                const thumb = document.createElement('span');
                thumb.className = 'crack-api-result-thumb';
                if (item.imageUrl) {
                    const img = document.createElement('img');
                    img.loading = 'lazy';
                    img.decoding = 'async';
                    img.src = item.imageUrl;
                    thumb.appendChild(img);
                }

                const main = document.createElement('span');
                main.className = 'crack-api-result-main';

                const title = document.createElement('span');
                title.className = 'crack-api-result-title';
                title.textContent = item.title || '제목 없음';

                const meta = document.createElement('span');
                meta.className = 'crack-api-result-meta';
                if (item.source === 'root') {
                    meta.textContent = `채팅 목록${item.updatedAt ? ' · ' + formatArchiveDate(item.updatedAt) : ''}`;
                } else {
                    meta.textContent = `${item.folderName || '보관함'}${item.updatedAt ? ' · ' + formatArchiveDate(item.updatedAt) : ''}`;
                }

                main.appendChild(title);
                if (item.lastMessage) {
                    const preview = document.createElement('span');
                    preview.className = 'crack-api-result-preview';
                    preview.textContent = cleanText(item.lastMessage).slice(0, 180);
                    main.appendChild(preview);
                }
                main.appendChild(meta);

                btn.appendChild(thumb);
                btn.appendChild(main);
                resultsBox.appendChild(btn);
            });
        }

        appendGroup('보관함', archiveMatches);
        appendGroup('채팅 목록', rootMatches);

        resultsBox.classList.add('visible');
    }

    function handleArchiveSearchQuery(query) {
        const normalizedQuery = normalizeSearchText(query);
        renderArchiveSearchResults(normalizedQuery);

        if (normalizedQuery) {
            ensureArchiveSearchIndex();
        }
    }

    // 검색 중에는 기존 사이드바 DOM을 숨기거나 필터링하지 않는다.
    //          검색 결과 fixed overlay만 갱신해서 타자 끊김과 레이아웃 충돌을 줄인다.
    function filterChatsAndFolders(query) {
        const normalizedQuery = normalizeSearchText(query || '');

        if (!normalizedQuery) {
            handleArchiveSearchQuery('');
            cleanupLegacySearchModeArtifacts();
            return;
        }

        handleArchiveSearchQuery(normalizedQuery);
    }

    // ── 폴더 정리기 v12의 로컬 폴더 데이터 ───────────────────────────
    const LOCAL_FOLDER_KEY = 'towa_wrtn_folders_v8';
    const LOCAL_MAP_KEY = 'towa_wrtn_map_v8';
    const LOCAL_SORT_KEY = 'towa_wrtn_sort_v1';
    const LOCAL_UI_KEY = 'towa_wrtn_ui_state_v1';
    const LOCAL_ROOT_ID = 'root_folder_all';
    const LOCAL_PALETTE = ['#ff922b', '#fab005', '#94d82d', '#51cf66', '#20c997', '#22b8cf', '#339af0', '#5c7cfa', '#845ef7', '#be4bdb', '#f06595', '#868e96'];
    let localFolderView = LOCAL_ROOT_ID;
    let localFolderVersion = 0;

    function readLocalJson(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
        catch { return fallback; }
    }
    function migrateLocalFolders() {
        try {
            if (!localStorage.getItem(LOCAL_FOLDER_KEY) && localStorage.getItem('towa_wrtn_folders_v3')) {
                localStorage.setItem(LOCAL_FOLDER_KEY, localStorage.getItem('towa_wrtn_folders_v3'));
                if (!localStorage.getItem(LOCAL_MAP_KEY) && localStorage.getItem('towa_wrtn_map_v3')) {
                    localStorage.setItem(LOCAL_MAP_KEY, localStorage.getItem('towa_wrtn_map_v3'));
                }
            }
        } catch (error) { console.warn('[Crack UI] 폴더 데이터 마이그레이션 실패:', error); }
    }
    migrateLocalFolders();

    function normalizeLocalColor(value) {
        const raw = String(value || '').toLowerCase();
        if (LOCAL_PALETTE.includes(raw)) return raw;
        const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(raw);
        if (rgb) {
            const hex = '#' + rgb.slice(1).map(channel => Number(channel).toString(16).padStart(2, '0')).join('');
            if (LOCAL_PALETTE.includes(hex)) return hex;
        }
        return LOCAL_PALETTE[0];
    }

    function loadLocalFolders() {
        const saved = readLocalJson(LOCAL_FOLDER_KEY, []);
        const folders = Array.isArray(saved) ? saved.filter(folder => folder && typeof folder.id === 'string' && folder.id !== LOCAL_ROOT_ID)
            .map(folder => ({ id: folder.id, name: String(folder.name || '새 폴더'), color: normalizeLocalColor(folder.color) })) : [];
        return [{ id: LOCAL_ROOT_ID, name: '전체', color: 'transparent' }, ...folders];
    }
    function saveLocalFolders(folders) {
        localStorage.setItem(LOCAL_FOLDER_KEY, JSON.stringify(folders));
        localFolderVersion++;
        refreshLocalFolderSurfaces();
    }
    function localChatKey(href) {
        try { return new URL(String(href || ''), location.origin).pathname.replace(/\/$/, ''); }
        catch { return String(href || '').split('?')[0].replace(/\/$/, ''); }
    }
    function loadLocalMap() {
        const raw = readLocalJson(LOCAL_MAP_KEY, {});
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
        const result = {};
        for (const [href, folderId] of Object.entries(raw)) {
            if (typeof folderId === 'string') result[localChatKey(href)] = folderId;
        }
        return result;
    }
    function saveLocalMap(map) {
        localStorage.setItem(LOCAL_MAP_KEY, JSON.stringify(map));
        localFolderVersion++;
        refreshLocalFolderSurfaces();
    }
    function loadLocalSort() { return readLocalJson(LOCAL_SORT_KEY, {}); }
    function folderForItem(item, map = loadLocalMap()) { return map[localChatKey(item.href)] || LOCAL_ROOT_ID; }
    function localFolderItems(folderId) {
        const map = loadLocalMap();
        const items = Array.isArray(archiveSearchState.items) ? archiveSearchState.items : [];
        const result = items.filter(item => item?.href && folderForItem(item, map) === folderId);
        const present = new Set(result.map(item => localChatKey(item.href)));
        const meta = readLocalJson('towa_wrtn_meta_v1', {});
        for (const [href, assignedId] of Object.entries(map)) {
            if (assignedId !== folderId || present.has(href)) continue;
            const saved = meta[href] || {};
            result.push({ href, title: saved.title || '채팅방', imageUrl: saved.imgSrc || '', lastMessage: saved.desc || '', updatedAt: saved.lastSeen || '' });
        }
        const order = loadLocalSort()[folderId] || [];
        if (Array.isArray(order) && order.length) {
            const positions = new Map(order.map((href, index) => [localChatKey(href), index]));
            result.sort((a, b) => (positions.get(localChatKey(a.href)) ?? Infinity) - (positions.get(localChatKey(b.href)) ?? Infinity));
        } else result.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        return result;
    }
    function setLocalFolderForKeys(keys, folderId) {
        if (!keys.length) return;
        const map = loadLocalMap();
        for (const key of keys) {
            if (folderId === LOCAL_ROOT_ID) delete map[localChatKey(key)];
            else map[localChatKey(key)] = folderId;
        }
        saveLocalMap(map);
    }
    function refreshLocalFolderSurfaces() {
        renderLocalFolderBar();
        if (loungeState.open) renderLounge();
    }

    function createLocalFolder(name) {
        const folders = loadLocalFolders();
        const id = `f_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        folders.push({ id, name: String(name).trim().slice(0, 60), color: LOCAL_PALETTE[(folders.length - 1) % LOCAL_PALETTE.length] });
        saveLocalFolders(folders);
        return id;
    }

    // 사이드바의 색상 모아보기는 localFolderView = 'color:<key>'로 폴더 보기와 같은 자리를 쓴다.
    const COLOR_VIEW_PREFIX = 'color:';
    function colorViewKey(view = localFolderView) {
        return String(view).startsWith(COLOR_VIEW_PREFIX) ? String(view).slice(COLOR_VIEW_PREFIX.length) : '';
    }
    function colorItems(key) {
        const items = Array.isArray(archiveSearchState.items) ? archiveSearchState.items : [];
        return items.filter(item => item?.href && item.chatId && readChatColorById(item.chatId) === key)
            .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    }

    function chatIdFromKey(key) {
        return String(key || '').match(/\/episodes\/([a-f0-9]+)/i)?.[1] || '';
    }

    let tunerToastTimer = 0;
    function showTunerToast(text) {
        let toast = document.getElementById('crack-tuner-toast');
        if (!toast) {
            toast = ctEl('div');
            toast.id = 'crack-tuner-toast';
            toast.setAttribute('role', 'status');
            document.body.append(toast);
        }
        toast.textContent = text;
        requestAnimationFrame(() => toast.classList.add('is-on'));
        clearTimeout(tunerToastTimer);
        tunerToastTimer = setTimeout(() => toast.classList.remove('is-on'), 1800);
    }

    // 끌어다 놓기: 한눈에 보기 카드(여러 개 가능)나 사이드바 채팅 링크를 폴더/색상에 넣는다.
    const CHAT_DRAG_TYPE = 'application/x-crack-chat-keys';
    function isChatDrag(event) {
        const types = [...(event.dataTransfer?.types || [])];
        return types.includes(CHAT_DRAG_TYPE) || types.includes('text/uri-list');
    }
    function readDraggedChatKeys(event) {
        const data = event.dataTransfer;
        if (!data) return [];
        try {
            const keys = JSON.parse(data.getData(CHAT_DRAG_TYPE) || '[]');
            if (Array.isArray(keys) && keys.length) return keys.map(localChatKey);
        } catch (e) {}
        const keys = [];
        for (const line of String(data.getData('text/uri-list') || '').split(/\r?\n/)) {
            if (!line || line.startsWith('#')) continue;
            try {
                const url = new URL(line.trim(), location.origin);
                if (url.origin === location.origin && /\/episodes\/[a-f0-9]+/i.test(url.pathname)) keys.push(localChatKey(url.pathname));
            } catch (e) {}
        }
        return [...new Set(keys)];
    }
    // 폴더 또는 색상에 담고 알림을 띄운다. target: { folderId } | { color }
    function dropChatsInto(keys, target) {
        if (!keys.length) return false;
        if (target.color !== undefined) {
            const ids = keys.map(chatIdFromKey).filter(Boolean);
            if (!ids.length) return false;
            ids.forEach(id => saveColor('episode_' + id, target.color || null));
            loungeState.lastSig = '';
            renderLocalFolderBar();
            if (loungeState.open) renderLounge();
            showTunerToast(target.color ? `${ids.length}개를 「${colorLabel(target.color)}」 색으로 표시했어요` : `${ids.length}개의 색상을 지웠어요`);
            return true;
        }
        const folder = loadLocalFolders().find(entry => entry.id === target.folderId);
        if (!folder) return false;
        setLocalFolderForKeys(keys, folder.id);
        showTunerToast(folder.id === LOCAL_ROOT_ID ? `${keys.length}개를 폴더에서 뺐어요` : `${keys.length}개를 「${folder.name}」에 넣었어요`);
        return true;
    }

    let localFolderToggleAnim = false;
    function renderLocalFolderBar() {
        const search = document.querySelector('.crack-search-container');
        if (!search?.parentElement) return;
        let bar = document.getElementById('crack-local-folders');
        if (!bar) {
            bar = ctEl('section', '');
            bar.id = 'crack-local-folders';
            search.parentElement.insertBefore(bar, search);
            bar.addEventListener('click', onLocalFolderBarClick);
            bindLocalFolderBarDrop(bar);
        }
        if (bar.nextElementSibling !== search) search.parentElement.insertBefore(bar, search);
        const theme = document.body.getAttribute('data-theme') || 'dark';
        const signature = `${localFolderVersion}|${colorVersion}|${theme}|${localFolderView}|${archiveSearchState.savedAt}|${archiveSearchState.status}|${archiveSearchState.items.length}|${localStorage.getItem(LOCAL_UI_KEY)}`;
        if (bar.dataset.renderSig === signature && document.getElementById('crack-folder-results')?.previousElementSibling === search) {
            getListScope()?.classList.toggle('crack-folder-filtering', localFolderView !== LOCAL_ROOT_ID);
            return;
        }
        bar.dataset.renderSig = signature;
        const folders = loadLocalFolders();
        const viewColor = colorViewKey();
        // 1.4.1: 사이드바의 색상 모아보기와 새 폴더 칸을 뺐다. 예전에 고른 색상 보기는 전체로 돌린다.
        if (viewColor || !folders.some(folder => folder.id === localFolderView)) localFolderView = LOCAL_ROOT_ID;
        const state = readLocalJson(LOCAL_UI_KEY, { listOpen: true });
        const open = state?.listOpen !== false;
        const userFolders = folders.slice(1);
        bar.hidden = !userFolders.length;
        const toggle = ctEl('button', 'crack-folder-toggle');
        toggle.type = 'button'; toggle.dataset.folderAction = 'toggle';
        toggle.setAttribute('aria-label', open ? '내 폴더 접기' : '내 폴더 펼치기');
        toggle.setAttribute('aria-expanded', String(open));
        const chevron = ctEl('span', 'crack-folder-toggle-chev');
        chevron.innerHTML = ctSvg('<path d="m6 15 6-6 6 6"/>', 14);
        toggle.append(ctEl('span', 'crack-folder-toggle-label', '내 폴더'), ctEl('span', 'crack-folder-toggle-count', userFolders.length), chevron);
        const tabs = ctEl('div', 'crack-folder-tabs');
        tabs.hidden = !open;
        if (localFolderToggleAnim) {
            localFolderToggleAnim = false;
            toggle.classList.add(open ? 'is-opening' : 'is-closing');
            if (open) tabs.classList.add('is-opening');
        }
        for (const folder of userFolders) {
            const button = ctEl('button', 'crack-folder-tab');
            button.type = 'button'; button.dataset.folderId = folder.id;
            button.classList.toggle('is-on', folder.id === localFolderView);
            button.style.setProperty('--folder-color', folder.color);
            const icon = ctEl('span', 'crack-folder-tab-icon');
            icon.innerHTML = CT_ICON.folder;
            button.append(icon, ctEl('span', 'crack-folder-tab-text', folder.name));
            tabs.append(button);
        }
        bar.replaceChildren(toggle, tabs);
        renderLocalFolderResults(bar, folders);
    }
    function renderLocalFolderResults(bar, folders) {
        let results = document.getElementById('crack-folder-results');
        if (!results) { results = ctEl('section', ''); results.id = 'crack-folder-results'; }
        const search = document.querySelector('.crack-search-container');
        if (search && results.previousElementSibling !== search) search.insertAdjacentElement('afterend', results);
        const selected = localFolderView !== LOCAL_ROOT_ID;
        results.hidden = !selected;
        const scope = getListScope();
        scope?.classList.toggle('crack-folder-filtering', selected);
        if (!selected) { results.replaceChildren(); return; }
        const viewColor = colorViewKey();
        const folder = viewColor ? null : folders.find(entry => entry.id === localFolderView);
        const stripeColor = viewColor ? (getThemeColors().accents?.[viewColor] || colorValues[viewColor]) : (folder?.color || LOCAL_PALETTE[0]);
        const items = viewColor ? colorItems(viewColor) : localFolderItems(localFolderView);
        const frag = document.createDocumentFragment();
        const loading = archiveSearchState.status === 'indexing' || archiveSearchState.status === 'idle';
        if (!items.length) frag.append(ctEl('div', 'crack-folder-empty', loading
            ? '채팅방을 불러오는 중이에요.'
            : viewColor ? `「${colorLabel(viewColor)}」 색으로 표시한 채팅방이 없어요.` : '이 폴더는 비어 있어요. 채팅방을 우클릭하거나 폴더 칸으로 끌어다 넣으세요.'));
        for (const item of items) {
            const card = ctEl('a', 'crack-folder-card');
            card.href = item.href;
            card.draggable = true;
            card.dataset.folderHref = item.href;
            const stripe = ctEl('i', 'crack-folder-card-border');
            stripe.style.setProperty('--folder-color', stripeColor);
            const thumb = ctEl('span', 'crack-folder-card-thumb');
            if (item.imageUrl) { const img = document.createElement('img'); img.src = item.imageUrl; img.alt = ''; thumb.append(img); }
            else thumb.innerHTML = CT_ICON.chat;
            const content = ctEl('span', 'crack-folder-card-content');
            content.append(ctEl('span', 'crack-folder-card-title', item.title || '제목 없음'));
            content.append(ctEl('span', 'crack-folder-card-desc', item.lastMessage || item.storyName || ''));
            card.append(stripe, thumb, content);
            frag.append(card);
        }
        results.replaceChildren(frag);
        if (!results.dataset.dragReady) {
            results.dataset.dragReady = 'true';
            let dragged = '';
            results.addEventListener('dragstart', event => { dragged = event.target.closest('.crack-folder-card')?.dataset.folderHref || ''; });
            results.addEventListener('dragover', event => { if (dragged && !colorViewKey() && event.target.closest('.crack-folder-card')) event.preventDefault(); });
            results.addEventListener('drop', event => {
                const target = event.target.closest('.crack-folder-card')?.dataset.folderHref;
                if (!dragged || colorViewKey() || !target || dragged === target) return;
                event.preventDefault();
                const order = [...results.querySelectorAll('.crack-folder-card')].map(card => card.dataset.folderHref);
                order.splice(order.indexOf(dragged), 1);
                order.splice(order.indexOf(target), 0, dragged);
                const sort = loadLocalSort(); sort[localFolderView] = order;
                localStorage.setItem(LOCAL_SORT_KEY, JSON.stringify(sort));
                dragged = '';
                renderLocalFolderResults(bar, loadLocalFolders());
            });
            results.addEventListener('dragend', () => { dragged = ''; });
        }
    }
    function bindLocalFolderBarDrop(bar) {
        const dropTarget = event => event.target.closest?.('.crack-folder-tab[data-folder-id], .crack-folder-color[data-color-view]');
        const clear = () => bar.querySelectorAll('.is-drop').forEach(el => el.classList.remove('is-drop'));
        bar.addEventListener('dragover', event => {
            const target = dropTarget(event);
            if (!target || !isChatDrag(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            if (!target.classList.contains('is-drop')) { clear(); target.classList.add('is-drop'); }
        });
        bar.addEventListener('dragleave', event => {
            const target = dropTarget(event);
            if (target && !target.contains(event.relatedTarget)) target.classList.remove('is-drop');
        });
        bar.addEventListener('drop', event => {
            const target = dropTarget(event);
            clear();
            if (!target) return;
            const keys = readDraggedChatKeys(event);
            if (!keys.length) return;
            event.preventDefault();
            dropChatsInto(keys, target.dataset.colorView ? { color: target.dataset.colorView } : { folderId: target.dataset.folderId });
        });
    }
    function onLocalFolderBarClick(event) {
        const action = event.target.closest('[data-folder-action]')?.dataset.folderAction;
        if (action === 'toggle') {
            const state = readLocalJson(LOCAL_UI_KEY, { listOpen: true });
            state.listOpen = state.listOpen === false;
            try { localStorage.setItem(LOCAL_UI_KEY, JSON.stringify(state)); } catch (e) {}
            localFolderToggleAnim = true;
            renderLocalFolderBar();
            return;
        }
        if (action === 'create') {
            openLocalFolderManager(true);
            return;
        }
        const tab = event.target.closest('[data-folder-id], [data-color-view]');
        if (tab) {
            const view = tab.dataset.colorView ? COLOR_VIEW_PREFIX + tab.dataset.colorView : tab.dataset.folderId;
            localFolderView = localFolderView === view ? LOCAL_ROOT_ID : view;
            renderLocalFolderBar();
            if (localFolderView !== LOCAL_ROOT_ID) {
                ensureArchiveSearchIndex();
                archiveSearchState.inFlight?.then(() => renderLocalFolderBar()).catch(() => {});
            }
        }
    }

    function openLocalFolderManager(focusCreate = false) {
        document.getElementById('crack-folder-manager')?.remove();
        const returnFocus = document.activeElement;
        const overlay = ctEl('div', 'crack-folder-manage');
        overlay.id = 'crack-folder-manager';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'crack-folder-manager-title');
        const panel = ctEl('section', 'crack-folder-manage-panel');
        const head = ctEl('div', 'crack-folder-manage-head');
        const mark = ctEl('span', 'crack-folder-manage-mark');
        mark.innerHTML = CT_ICON.folder;
        const heading = ctEl('div', 'crack-folder-manage-heading');
        const title = ctEl('h2', '', '내 폴더 관리');
        title.id = 'crack-folder-manager-title';
        heading.append(title, ctEl('p', '', '폴더를 선택해 이름, 색상, 순서를 변경하세요.'));
        const closeButton = ctEl('button', 'crack-folder-manage-close');
        closeButton.type = 'button';
        closeButton.innerHTML = CT_ICON.x;
        closeButton.setAttribute('aria-label', '닫기');
        closeButton.title = '닫기';
        head.append(mark, heading, closeButton);

        const createForm = ctEl('div', 'crack-folder-create-form');
        const createLabel = ctEl('label', '', '새 폴더 이름');
        createLabel.htmlFor = 'crack-folder-new-name';
        const createInput = ctEl('input');
        createInput.id = 'crack-folder-new-name';
        createInput.type = 'text'; createInput.maxLength = 60; createInput.placeholder = '폴더 이름을 입력하세요';
        const createButton = ctEl('button', 'crack-folder-create');
        createButton.type = 'button';
        createButton.innerHTML = `${CT_ICON.plus}<span>만들기</span>`;
        createButton.disabled = true;
        const createHint = ctEl('p', 'crack-folder-create-hint');
        createHint.hidden = !loungeState.selected.size;
        if (loungeState.selected.size) createHint.textContent = `선택한 채팅방 ${loungeState.selected.size}개를 새 폴더에 넣습니다.`;
        createForm.append(createLabel, createInput, createButton, createHint);
        const list = ctEl('div', 'crack-folder-manage-list');
        list.setAttribute('aria-label', '폴더 목록');
        const inspector = ctEl('div', 'crack-folder-inspector');
        panel.append(head, createForm, list, inspector);
        overlay.append(panel);
        document.body.append(overlay);
        requestAnimationFrame(() => overlay.classList.add('is-open'));
        let selectedFolderId = loadLocalFolders()[1]?.id || null;
        function close() {
            overlay.remove();
            refreshLocalFolderSurfaces();
            const focusTarget = returnFocus?.isConnected ? returnFocus : document.querySelector('#crack-lounge [data-folder-tool="manage"]') || document.querySelector('.crack-folder-toggle');
            focusTarget?.focus?.();
        }
        closeButton.addEventListener('click', close);
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
            if (event.key !== 'Tab') return;
            const focusable = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled)')].filter(node => !node.closest('[hidden]'));
            if (!focusable.length) return;
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        });
        createInput.addEventListener('input', () => { createButton.disabled = !createInput.value.trim(); });
        function create() {
            const name = createInput.value.trim();
            if (!name) { createInput.focus(); return; }
            const id = createLocalFolder(name);
            selectedFolderId = id;
            if (loungeState.selected.size) {
                setLocalFolderForKeys([...loungeState.selected], id);
                loungeState.selected.clear();
                if (loungeState.open) renderLounge();
            }
            createInput.value = '';
            createButton.disabled = true;
            createHint.hidden = true;
            renderFolders();
        }
        createButton.addEventListener('click', create);
        createInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); create(); } });
        function renderFolders() {
            list.replaceChildren();
            const folders = loadLocalFolders().slice(1);
            if (!folders.some(folder => folder.id === selectedFolderId)) selectedFolderId = folders[0]?.id || null;
            if (!folders.length) list.append(ctEl('p', 'crack-folder-manage-empty', '아직 만든 폴더가 없어요. 위에서 첫 폴더를 만들어보세요.'));
            folders.forEach((folder, index) => {
                const file = ctEl('button', 'crack-folder-file');
                file.type = 'button';
                file.dataset.folderId = folder.id;
                file.style.setProperty('--folder-color', folder.color);
                file.classList.toggle('is-selected', folder.id === selectedFolderId);
                file.setAttribute('aria-pressed', String(folder.id === selectedFolderId));
                file.title = folder.name;
                const icon = ctEl('span', 'crack-folder-file-icon');
                icon.innerHTML = CT_ICON.folder;
                file.append(icon, ctEl('span', 'crack-folder-file-name', folder.name));
                file.addEventListener('click', () => {
                    selectedFolderId = folder.id;
                    for (const tile of list.querySelectorAll('.crack-folder-file')) {
                        const selected = tile.dataset.folderId === selectedFolderId;
                        tile.classList.toggle('is-selected', selected);
                        tile.setAttribute('aria-pressed', String(selected));
                    }
                    renderInspector();
                });
                list.append(file);
            });
            renderInspector();
        }
        function move(folderId, step) {
            const all = loadLocalFolders();
            const from = all.findIndex(folder => folder.id === folderId), to = from + step;
            if (from < 1 || to < 1 || to >= all.length) return;
            [all[from], all[to]] = [all[to], all[from]];
            saveLocalFolders(all); renderFolders();
            list.querySelector('.crack-folder-file.is-selected')?.focus();
        }
        function renderInspector() {
            inspector.replaceChildren();
            const folders = loadLocalFolders().slice(1);
            const index = folders.findIndex(folder => folder.id === selectedFolderId);
            inspector.hidden = index < 0;
            if (index < 0) return;
            const folder = folders[index];
            const top = ctEl('div', 'crack-folder-inspector-top');
            const heading = ctEl('strong', '', '선택한 폴더');
            function action(icon, label, onClick, disabled = false, className = '') {
                const button = ctEl('button', className);
                button.type = 'button'; button.innerHTML = icon;
                button.title = label; button.setAttribute('aria-label', label);
                button.disabled = disabled; button.addEventListener('click', onClick);
                return button;
            }
            const upIcon = ctSvg('<path d="M12 19V5m-6 6 6-6 6 6"/>', 15);
            const downIcon = ctSvg('<path d="M12 5v14m-6-6 6 6 6-6"/>', 15);
            const trashIcon = ctSvg('<path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v6m4-6v6"/>', 15);
            const up = action(upIcon, '앞으로 이동', () => move(folder.id, -1), index === 0);
            const down = action(downIcon, '뒤로 이동', () => move(folder.id, 1), index === folders.length - 1);
            const remove = action(trashIcon, '폴더 삭제', () => {
                const currentName = loadLocalFolders().find(entry => entry.id === folder.id)?.name || folder.name;
                if (!confirm(`「${currentName}」 폴더를 삭제할까요? 채팅방은 삭제되지 않습니다.`)) return;
                if (localFolderView === folder.id) localFolderView = LOCAL_ROOT_ID;
                if (loungeState.folder === `local:${folder.id}`) loungeState.folder = 'all';
                const map = loadLocalMap();
                for (const [href, id] of Object.entries(map)) if (id === folder.id) delete map[href];
                saveLocalMap(map);
                saveLocalFolders(loadLocalFolders().filter(entry => entry.id !== folder.id));
                renderFolders();
                (list.querySelector('.crack-folder-file.is-selected') || createInput).focus();
            }, false, 'crack-folder-delete');
            top.append(heading, up, down, remove);
            const nameLabel = ctEl('label', '', '폴더 이름');
            nameLabel.htmlFor = 'crack-folder-edit-name';
            const nameInput = ctEl('input');
            nameInput.id = 'crack-folder-edit-name';
            nameInput.type = 'text'; nameInput.maxLength = 60; nameInput.value = folder.name;
            nameInput.addEventListener('change', () => {
                const next = nameInput.value.trim();
                const all = loadLocalFolders();
                const target = all.find(entry => entry.id === folder.id);
                if (!target) return;
                if (!next) { nameInput.value = target.name; return; }
                target.name = next;
                saveLocalFolders(all);
                const tile = [...list.querySelectorAll('.crack-folder-file')].find(node => node.dataset.folderId === folder.id);
                if (tile) { tile.querySelector('.crack-folder-file-name').textContent = next; tile.title = next; }
            });
            const paletteLabel = ctEl('label', '', '폴더 색상');
            paletteLabel.id = 'crack-folder-palette-label';
            const palette = ctEl('div', 'crack-folder-palette');
            palette.setAttribute('role', 'group');
            palette.setAttribute('aria-labelledby', paletteLabel.id);
            LOCAL_PALETTE.forEach((color, colorIndex) => {
                const swatch = ctEl('button');
                swatch.type = 'button';
                swatch.style.setProperty('--swatch-color', color);
                swatch.classList.toggle('is-selected', color === folder.color);
                swatch.setAttribute('aria-label', `색상 ${colorIndex + 1}`);
                swatch.setAttribute('aria-pressed', String(color === folder.color));
                swatch.addEventListener('click', () => {
                    const all = loadLocalFolders();
                    const target = all.find(entry => entry.id === folder.id);
                    if (!target) return;
                    target.color = color;
                    saveLocalFolders(all);
                    const tile = [...list.querySelectorAll('.crack-folder-file')].find(node => node.dataset.folderId === folder.id);
                    tile?.style.setProperty('--folder-color', color);
                    for (const button of palette.querySelectorAll('button')) {
                        const selected = button === swatch;
                        button.classList.toggle('is-selected', selected);
                        button.setAttribute('aria-pressed', String(selected));
                    }
                });
                palette.append(swatch);
            });
            inspector.append(top, nameLabel, nameInput, paletteLabel, palette);
        }
        renderFolders();
        (focusCreate ? createInput : closeButton).focus();
    }

    let localAssignReturnFocus = null;
    function closeLocalAssignMenu(restoreFocus = false) {
        const menu = document.getElementById('crack-local-assign');
        if (!menu) return;
        menu.remove();
        const focusTarget = localAssignReturnFocus;
        localAssignReturnFocus = null;
        if (restoreFocus && focusTarget?.isConnected) focusTarget.focus?.({ preventScroll: true });
    }
    // 폴더 선택 창. hrefs 하나(우클릭···· 메뉴)나 여러 개(선택 도구)를 같은 화면으로 처리한다.
    // waitFor: 닫히는 중인 Radix 메뉴. 메뉴가 사라지며 트리거로 포커스를 돌려준 뒤에 포커스를 가져온다.
    function openLocalAssignMenu({ x, y, hrefs, title, onDone, waitFor } = {}) {
        const keys = [...new Set((hrefs || []).filter(Boolean).map(localChatKey))];
        if (!keys.length) return;
        closeLocalAssignMenu();
        localAssignReturnFocus = waitFor ? null : document.activeElement;

        const map = loadLocalMap();
        const folders = loadLocalFolders().slice(1);
        const counts = new Map();
        for (const key of keys) {
            const id = map[key] || LOCAL_ROOT_ID;
            counts.set(id, (counts.get(id) || 0) + 1);
        }

        const menu = ctEl('div');
        menu.id = 'crack-local-assign';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', '폴더에 넣기');
        const head = ctEl('div', 'crack-la-head');
        head.append(ctEl('strong', '', keys.length > 1 ? '선택한 채팅방' : (cleanText(title) || '폴더에 넣기')));
        if (keys.length > 1) head.append(ctEl('em', '', `${keys.length}개`));
        menu.append(head);

        const finish = folderId => {
            const folder = loadLocalFolders().find(entry => entry.id === folderId);
            if (!folder) return;
            closeLocalAssignMenu(true);
            setLocalFolderForKeys(keys, folderId);
            showTunerToast(folderId === LOCAL_ROOT_ID
                ? `${keys.length > 1 ? keys.length + '개를 ' : ''}폴더에서 뺐어요`
                : `${keys.length > 1 ? keys.length + '개를 ' : ''}「${folder.name}」에 넣었어요`);
            onDone?.(folderId);
        };

        const list = ctEl('div', 'crack-la-list');
        for (const folder of folders) {
            const count = counts.get(folder.id) || 0;
            const button = ctEl('button');
            button.type = 'button';
            button.setAttribute('role', 'menuitemradio');
            button.setAttribute('aria-checked', String(count === keys.length));
            button.classList.toggle('is-current', count === keys.length);
            button.style.setProperty('--folder-color', folder.color);
            const icon = ctEl('span', 'crack-la-ic');
            icon.innerHTML = CT_ICON.folder;
            button.append(icon, ctEl('span', 'crack-la-name', folder.name));
            if (count) button.append(ctEl('span', `crack-la-check${count < keys.length ? ' is-part' : ''}`, count < keys.length ? `${count}` : '✓'));
            button.addEventListener('click', () => finish(folder.id));
            list.append(button);
        }
        if (!folders.length) list.append(ctEl('div', 'crack-la-empty', '아직 폴더가 없어요. 아래에서 바로 만들 수 있어요.'));
        menu.append(list);

        const assigned = keys.length - (counts.get(LOCAL_ROOT_ID) || 0);
        menu.append(ctEl('div', 'crack-la-sep'));
        if (assigned) {
            const remove = ctEl('button', 'crack-la-muted');
            remove.type = 'button';
            remove.setAttribute('role', 'menuitem');
            const icon = ctEl('span', 'crack-la-ic');
            icon.innerHTML = ctSvg('<path d="M18 6 6 18M6 6l12 12"/>', 14);
            remove.append(icon, ctEl('span', 'crack-la-name', '폴더에서 빼기'));
            remove.addEventListener('click', () => finish(LOCAL_ROOT_ID));
            menu.append(remove);
        }

        const newRow = ctEl('div', 'crack-la-new');
        const newOpen = ctEl('button', 'crack-la-muted');
        newOpen.type = 'button';
        newOpen.setAttribute('role', 'menuitem');
        const plus = ctEl('span', 'crack-la-ic');
        plus.innerHTML = ctSvg('<path d="M12 5v14M5 12h14"/>', 15);
        newOpen.append(plus, ctEl('span', 'crack-la-name', '새 폴더 만들어 넣기'));
        const showForm = () => {
            const input = ctEl('input');
            input.type = 'text';
            input.maxLength = 60;
            input.placeholder = '폴더 이름';
            input.setAttribute('aria-label', '새 폴더 이름');
            const make = ctEl('button', 'crack-la-make', '만들기');
            make.type = 'button';
            make.disabled = true;
            const submit = () => {
                const name = input.value.trim();
                if (!name) return;
                finish(createLocalFolder(name));
            };
            input.addEventListener('input', () => { make.disabled = !input.value.trim(); });
            input.addEventListener('keydown', event => {
                if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); submit(); }
            });
            make.addEventListener('click', submit);
            newRow.replaceChildren(input, make);
            input.focus();
        };
        newOpen.addEventListener('click', showForm);
        newRow.append(newOpen);
        menu.append(newRow);

        menu.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                closeLocalAssignMenu(true);
                return;
            }
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            if (event.target.matches('input')) return;
            const items = [...menu.querySelectorAll('button:not(:disabled)')];
            const index = items.indexOf(document.activeElement);
            const next = items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
            if (next) { event.preventDefault(); next.focus(); }
        });

        document.body.append(menu);
        const width = menu.offsetWidth;
        const height = menu.offsetHeight;
        menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;

        const focusFirst = () => {
            if (!menu.isConnected || menu.contains(document.activeElement)) return;
            (menu.querySelector('button.is-current') || menu.querySelector('button'))?.focus({ preventScroll: true });
        };
        if (!waitFor) { focusFirst(); return; }
        // Radix가 메뉴를 내리며 트리거로 포커스를 돌려준 다음에 가져온다.
        const startedAt = Date.now();
        const poll = () => {
            if (!menu.isConnected) return;
            if (!waitFor.isConnected || Date.now() - startedAt > 700) setTimeout(focusFirst, 30);
            else requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
    }
    document.addEventListener('pointerdown', event => {
        if (!event.target.closest?.('#crack-local-assign')) closeLocalAssignMenu();
    }, true);
    document.addEventListener('scroll', event => {
        if (!(event.target instanceof Element && event.target.closest('#crack-local-assign'))) closeLocalAssignMenu();
    }, true);
    window.addEventListener('resize', () => closeLocalAssignMenu(), { passive: true });

    // ── 한눈에 보기 (PC·모바일 넓은 목록) ─────────────────────────────
    // 크랙 원래 목록(Virtuoso)은 건드리지 않는다. 검색용으로 모아 둔 archiveSearchState.items로 따로 그린다.
    const LOUNGE_VIEW_KEY = 'crackTunerLoungeView_v1';
    const LOUNGE_GROUP_KEY = 'crackTunerLoungeGroup_v1';
    const LOUNGE_GROUP_LIMIT = 48;
    const loungeState = {
        open: false,
        folder: 'all',
        color: '',
        query: '',
        view: 'grid',
        group: 'folder', // folder | color
        colorView: 'all', // 색상별 묶음에서 고른 색: all | <key> | none
        selecting: false,
        selected: new Set(),
        eligible: [],
        expanded: new Set(),
        popChatId: '',
        colorsOpen: false,
        pollTimer: 0,
        queryTimer: 0,
        animTimer: 0,
        lastSig: ''
    };

    try {
        const savedView = localStorage.getItem(LOUNGE_VIEW_KEY);
        if (savedView === 'grid' || savedView === 'dense') loungeState.view = savedView;
        if (localStorage.getItem(LOUNGE_GROUP_KEY) === 'color') loungeState.group = 'color';
    } catch (e) {}

    function getLoungeRoot() {
        return document.getElementById('crack-lounge');
    }

    function readChatColorById(chatId) {
        if (!chatId) return '';
        try {
            return localStorage.getItem(STORAGE_KEY + 'episode_' + chatId) || '';
        } catch (e) {
            return '';
        }
    }

    function getLoungeSig() {
        return `${archiveSearchState.items.length}|${archiveSearchState.status}|${archiveSearchState.savedAt}|${localFolderVersion}|${loungeState.group === 'color' ? colorVersion : ''}`;
    }

    function ensureLounge() {
        let root = getLoungeRoot();
        if (root) return root;

        root = document.createElement('section');
        root.id = 'crack-lounge';
        root.setAttribute('aria-label', '한눈에 보기');
        root.setAttribute('aria-hidden', 'true');
        root.inert = true;
        root.innerHTML = `
            <header class="crack-lg-top">
                <button type="button" class="crack-lg-close" aria-label="접기" title="접기 (Esc)">${CT_ICON.back}</button>
                <div class="crack-lg-heading"><strong>한눈에 보기</strong><em class="crack-lg-sub"></em></div>
                <div class="crack-lg-search">${CT_ICON.search}<input type="text" placeholder="검색" aria-label="검색"><button type="button" class="crack-lg-clear" aria-label="지우기">${CT_ICON.x}</button></div>
                <div class="crack-lg-colors" role="group" aria-label="색으로 거르기">
                    <button type="button" class="crack-lg-cf is-all" data-k="" aria-expanded="false">전체</button>
                    <div class="crack-lg-cf-list"></div>
                </div>
                <div class="crack-lg-view-tools">
                    <div class="crack-lg-seg" data-seg="group" role="group" aria-label="묶는 기준"><i></i><button type="button" data-group="folder">폴더별</button><button type="button" data-group="color">색상별</button></div>
                    <div class="crack-lg-seg" data-seg="view" role="group" aria-label="보기 방식"><i></i><button type="button" data-view="grid">카드</button><button type="button" data-view="dense">촘촘히</button></div>
                    <div class="crack-lg-quick-actions" role="group" aria-label="폴더 도구">
                        <button type="button" class="crack-lg-select-btn" data-folder-tool="select" title="채팅방 골라서 폴더에 넣기" aria-label="채팅방 골라서 폴더에 넣기" aria-pressed="false">${CT_ICON.select}</button>
                        <button type="button" data-folder-tool="create" aria-label="폴더 만들기" title="폴더 만들기">${CT_ICON.plus}</button>
                        <button type="button" data-folder-tool="manage" aria-label="폴더 관리" title="폴더 관리">${CT_ICON.settings}</button>
                    </div>
                </div>
            </header>
            <div class="crack-lg-folder-tools" role="toolbar" aria-label="선택한 채팅방 관리">
                <button type="button" data-folder-tool="all">전체 선택</button>
                <button type="button" data-folder-tool="clear">해제</button>
                <span class="crack-lg-selected-count" aria-live="polite">0개 선택</span>
                <button type="button" class="is-primary" data-folder-tool="move" aria-haspopup="menu">${CT_ICON.folder}<span>폴더에 넣기</span></button>
                <button type="button" data-folder-tool="remove">폴더에서 빼기</button>
            </div>
            <div class="crack-lg-body">
                <nav class="crack-lg-rail" aria-label="보관함 고르기"></nav>
                <div class="crack-lg-scroll"><div class="crack-lg-status"></div><div class="crack-lg-groups"></div></div>
            </div>
            <div class="crack-lg-pop" role="menu" aria-label="채팅방 옵션"></div>
        `;
        bindLoungeDrag(root);

        root.addEventListener('click', onLoungeClick);
        root.addEventListener('input', onLoungeInput);
        root.addEventListener('keydown', event => {
            if (event.target.classList?.contains('crack-lg-gh-input')) return;
            if ((event.key === 'Enter' || (loungeState.selecting && event.key === ' ')) && event.target.classList?.contains('crack-lg-tile')) {
                event.preventDefault();
                openLoungeItem(event.target);
            }
        });
        root.querySelector('.crack-lg-scroll').addEventListener('scroll', closeLoungePop, { passive: true });

        document.body.appendChild(root);
        return root;
    }

    function isMobileLounge() {
        return window.innerWidth <= 900 || (window.innerWidth <= 1100 && window.matchMedia('(pointer: coarse)').matches);
    }

    function positionLounge(root, searchContainer) {
        if (!root) return;
        const mobile = isMobileLounge();
        root.classList.toggle('is-mobile', mobile);
        if (mobile) {
            const viewport = window.visualViewport;
            root.style.left = `${viewport?.offsetLeft || 0}px`;
            root.style.top = `${viewport?.offsetTop || 0}px`;
            root.style.width = `${viewport?.width || window.innerWidth}px`;
            root.style.height = `${viewport?.height || window.innerHeight}px`;
            root.style.right = 'auto';
            root.style.bottom = 'auto';
            return;
        }
        for (const key of ['width', 'height', 'right', 'bottom']) root.style.removeProperty(key);
        if (!searchContainer) { root.style.left = '0px'; root.style.top = '0px'; return; }
        const rect = getSearchSidebarRect(searchContainer);
        root.style.left = `${Math.max(0, Math.round(rect.left))}px`;
        root.style.top = `${Math.max(0, Math.round(rect.top))}px`;
        root.style.setProperty('--crack-lg-from', `${Math.max(180, Math.round(rect.width))}px`);
    }

    function playLoungeAnim(mode) {
        const box = getLoungeRoot()?.querySelector('.crack-lg-groups');
        if (!box || !mode) return;
        box.classList.remove('is-enter', 'is-swap');
        void box.offsetWidth;
        box.classList.add(mode === 'enter' ? 'is-enter' : 'is-swap');
        clearTimeout(loungeState.animTimer);
        loungeState.animTimer = setTimeout(() => box.classList.remove('is-enter', 'is-swap'), 1400);
    }

    function railAddButton() {
        const button = ctEl('button', 'crack-lg-rail-btn crack-lg-rail-add');
        button.type = 'button';
        button.dataset.colorAdd = 'rail';
        button.title = '색 추가';
        button.setAttribute('aria-label', '색 추가');
        button.innerHTML = ctSvg('<path d="M12 6v12M6 12h12"/>', 15);
        return button;
    }

    function makeLoungeRailButton(key, label, count, icon, kind = 'folder') {
        const button = ctEl('button', 'crack-lg-rail-btn');
        button.type = 'button';
        if (kind === 'color') {
            button.dataset.colorView = key;
            button.classList.toggle('is-on', loungeState.colorView === key);
        } else {
            button.dataset.folder = key;
            button.classList.toggle('is-on', loungeState.folder === key);
        }
        const ic = ctEl('span', 'crack-lg-rail-ic');
        ic.innerHTML = icon;
        // 채팅 목록/보관함 헤더 탐색(span 텍스트 비교)과 겹치지 않도록 span 대신 em을 쓴다.
        button.append(ic, ctEl('em', 'crack-lg-rail-name', label), ctEl('b', 'crack-lg-rail-count', count.toLocaleString()));
        return button;
    }

    function makeLoungeTile(item, index, color, themeColors, currentPath) {
        const tile = ctEl('div', 'crack-lg-tile');
        tile.setAttribute('role', loungeState.selecting ? 'button' : 'link');
        tile.tabIndex = 0;
        if (loungeState.selecting) tile.setAttribute('aria-pressed', String(loungeState.selected.has(localChatKey(item.href))));
        tile.dataset.chatId = item.chatId || '';
        tile.dataset.href = item.href || '';
        tile.classList.toggle('is-picked', loungeState.selected.has(localChatKey(item.href)));
        tile.title = item.source === 'root' ? (item.title || '') : `${item.folderName || '보관함'} / ${item.title || ''}`;
        tile.style.setProperty('--i', String(Math.min(index, 30)));

        if (color && themeColors.accents?.[color]) {
            tile.dataset.color = color;
            tile.style.setProperty('--c', themeColors.accents[color]);
            tile.style.setProperty('--cbg', themeColors.backgrounds?.[color] || 'transparent');
        }
        if (item.chatId && currentPath.includes(`/episodes/${item.chatId}`)) tile.classList.add('is-current');

        const thumb = ctEl('span', 'crack-lg-thumb');
        if (item.imageUrl) {
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.decoding = 'async';
            img.alt = '';
            img.draggable = false;
            img.src = item.imageUrl;
            thumb.appendChild(img);
        } else {
            thumb.textContent = (cleanText(item.title) || '?').charAt(0);
        }
        if (!isMobileLounge()) tile.draggable = true;

        const main = ctEl('span', 'crack-lg-main');
        main.append(
            ctEl('span', 'crack-lg-title', item.title || '제목 없음'),
            ctEl('span', 'crack-lg-pv', item.lastMessage || item.storyName || '')
        );

        const more = ctEl('button', 'crack-lg-more');
        more.type = 'button';
        more.setAttribute('aria-label', '색상·폴더');
        more.title = '색상·폴더 (우클릭)';
        more.setAttribute('aria-haspopup', 'menu');
        more.setAttribute('aria-expanded', 'false');
        more.innerHTML = CT_ICON.dots;

        const pick = ctEl('span', 'crack-lg-pick');
        pick.setAttribute('aria-hidden', 'true');
        pick.innerHTML = ctSvg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 10);
        tile.append(pick, thumb, main, ctEl('span', 'crack-lg-date', formatArchiveDate(item.updatedAt)), more);
        return tile;
    }

    function renderLounge(mode) {
        const root = getLoungeRoot();
        if (!root || !loungeState.open) return;

        const items = (Array.isArray(archiveSearchState.items) ? archiveSearchState.items : []).filter(Boolean);
        const themeColors = getThemeColors();
        const colorCache = new Map();
        const colorOf = item => {
            if (!colorCache.has(item.chatId)) colorCache.set(item.chatId, readChatColorById(item.chatId));
            return colorCache.get(item.chatId);
        };
        const query = normalizeSearchText(loungeState.query);
        const byColor = loungeState.group === 'color';
        const pass = item =>
            (byColor || !loungeState.color || colorOf(item) === loungeState.color) &&
            (!query || textMatchesQuery(`${item.title || ''} ${item.storyName || ''}`, query));
        const byRecent = (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));

        const rootItems = [];
        const folderMap = new Map();
        const localMap = loadLocalMap();
        const localFolders = loadLocalFolders().slice(1);
        const localGroups = localFolders.map(folder => ({ key: `local:${folder.id}`, name: folder.name, color: folder.color, items: [] }));
        const localGroupsById = new Map(localGroups.map(group => [group.key.slice(6), group]));
        for (const item of items) {
            const local = localGroupsById.get(folderForItem(item, localMap));
            if (local) { local.items.push(item); continue; }
            if (item.source === 'root') {
                rootItems.push(item);
                continue;
            }
            const key = item.folderId || item.folderName || '__archive__';
            if (!folderMap.has(key)) folderMap.set(key, { key, name: item.folderName || '보관함', items: [] });
            folderMap.get(key).items.push(item);
        }
        const folders = [...folderMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
        if (!['all', '__root__'].includes(loungeState.folder) && !folderMap.has(loungeState.folder) && !localGroups.some(group => group.key === loungeState.folder)) {
            loungeState.folder = 'all';
        }

        // 왼쪽 레일 + 묶음 목록
        const rail = root.querySelector('.crack-lg-rail');
        let groups;
        if (byColor) {
            // 색상은 폴더와 별개 표시라서, 같은 채팅이 폴더/보관함과 상관없이 색으로만 모인다.
            const colorGroups = Object.keys(colorValues).map(key => ({
                key: `color:${key}`, colorKey: key, name: colorLabel(key),
                color: themeColors.accents?.[key] || colorValues[key], items: []
            }));
            const noneGroup = { key: 'color:none', colorKey: 'none', name: '색 없음', items: [] };
            const colorGroupsByKey = new Map(colorGroups.map(group => [group.colorKey, group]));
            for (const item of items) (colorGroupsByKey.get(colorOf(item)) || noneGroup).items.push(item);
            if (loungeState.colorView !== 'all' && loungeState.colorView !== 'none' && !colorValues[loungeState.colorView]) loungeState.colorView = 'all';
            const dot = (color, none) => `<i class="crack-lg-rail-dot${none ? ' is-none' : ''}" style="--d:${color || 'transparent'}"></i>`;
            rail.replaceChildren(
                makeLoungeRailButton('all', '전체', items.length, CT_ICON.all, 'color'),
                ctEl('div', 'crack-lg-rail-h', '색상'),
                ...colorGroups.map(group => makeLoungeRailButton(group.colorKey, group.name, group.items.length, dot(group.color), 'color')),
                makeLoungeRailButton('none', noneGroup.name, noneGroup.items.length, dot('', true), 'color'),
                railAddButton()
            );
            if (loungeState.colorView === 'all') groups = [...colorGroups, noneGroup];
            else groups = [loungeState.colorView === 'none' ? noneGroup : colorGroupsByKey.get(loungeState.colorView)];
        } else {
            rail.replaceChildren(
                makeLoungeRailButton('all', '전체', items.length, CT_ICON.all),
                makeLoungeRailButton('__root__', '채팅 목록', rootItems.length, CT_ICON.chat),
                ctEl('div', 'crack-lg-rail-h', '내 폴더'),
                ...localGroups.map(folder => makeLoungeRailButton(folder.key, folder.name, folder.items.length, CT_ICON.folder)),
                ctEl('div', 'crack-lg-rail-h', '보관함'),
                ...folders.map(folder => makeLoungeRailButton(folder.key, folder.name, folder.items.length, CT_ICON.folder))
            );
            if (loungeState.folder === 'all') groups = [...localGroups, { key: '__root__', name: '채팅 목록', items: rootItems }, ...folders];
            else if (loungeState.folder === '__root__') groups = [{ key: '__root__', name: '채팅 목록', items: rootItems }];
            else groups = [localGroups.find(group => group.key === loungeState.folder) || folderMap.get(loungeState.folder)];
        }

        loungeState.eligible = groups.flatMap(group => group.items.filter(pass).map(item => localChatKey(item.href)));

        const limited = byColor ? loungeState.colorView === 'all' : loungeState.folder === 'all';
        const currentPath = location.pathname;
        const frag = document.createDocumentFragment();
        let tileIndex = 0;
        let shown = 0;
        let emptyCustomShown = false;

        for (const group of groups) {
            const list = group.items.filter(pass).sort(byRecent);
            const emptyCustom = !list.length && byColor && isCustomColor(group.colorKey) && !query;
            if (!list.length && !emptyCustom) continue;
            if (emptyCustom) emptyCustomShown = true;
            shown += list.length;

            const section = ctEl('section', 'crack-lg-group');
            const head = ctEl('div', 'crack-lg-gh');
            if (group.colorKey) {
                section.classList.add('crack-lg-color-group');
                if (group.color) section.style.setProperty('--folder-color', group.color);
                head.append(ctEl('i', `crack-lg-gh-dot${group.colorKey === 'none' ? ' is-none' : ''}`));
            } else if (group.color) {
                section.classList.add('crack-lg-local-folder');
                section.style.setProperty('--folder-color', group.color);
            }
            head.append(ctEl('strong', '', group.name), ctEl('em', '', list.length.toLocaleString()));
            if (group.colorKey && group.colorKey !== 'none') {
                const edit = ctEl('button', 'crack-lg-gh-edit');
                edit.type = 'button';
                edit.dataset.colorRename = group.colorKey;
                edit.title = '색상 이름 바꾸기';
                edit.setAttribute('aria-label', `${group.name} 이름 바꾸기`);
                edit.innerHTML = ctSvg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>', 13);
                head.append(edit);
            }
            if (group.colorKey && isCustomColor(group.colorKey)) {
                const del = ctEl('button', 'crack-lg-gh-edit crack-lg-gh-del');
                del.type = 'button';
                del.dataset.colorDelete = group.colorKey;
                del.title = '이 색 지우기';
                del.setAttribute('aria-label', `${group.name} 색 지우기`);
                del.innerHTML = ctSvg('<path d="M5 7h14"/><path d="M10 11v6M14 11v6"/><path d="M6.5 7l1 12h9l1-12"/><path d="M9.5 7V4.5h5V7"/>', 13);
                head.append(del);
            }
            const grid = ctEl('div', 'crack-lg-grid');
            const cap = limited && !loungeState.expanded.has(group.key) ? LOUNGE_GROUP_LIMIT : Infinity;
            list.slice(0, cap).forEach(item => {
                grid.appendChild(makeLoungeTile(item, tileIndex++, colorOf(item), themeColors, currentPath));
            });
            section.append(head, grid);
            if (emptyCustom) section.append(ctEl('div', 'crack-lg-gh-empty', '아직 이 색인 채팅방이 없어요'));

            if (list.length > cap) {
                const more = ctEl('button', 'crack-lg-more-btn', `${(list.length - cap).toLocaleString()}개 더 보기`);
                more.type = 'button';
                more.dataset.lgMore = group.key;
                section.appendChild(more);
            }
            frag.appendChild(section);
        }

        const filtered = (byColor ? loungeState.colorView !== 'all' : loungeState.folder !== 'all' || !!loungeState.color) || !!query;
        if (!shown && !emptyCustomShown) {
            const empty = ctEl('div', 'crack-lg-empty');
            if (!items.length) {
                empty.textContent = archiveSearchState.status === 'indexing' || archiveSearchState.status === 'idle'
                    ? '채팅 목록을 불러오는 중이에요.'
                    : '보여줄 채팅이 아직 없어요.';
            } else {
                empty.appendChild(ctEl('div', '', '조건에 맞는 채팅방이 없어요.'));
                if (filtered) {
                    const reset = ctEl('button', 'crack-smart-button small', '거르기 모두 풀기');
                    reset.type = 'button';
                    reset.dataset.lgReset = 'true';
                    empty.appendChild(reset);
                }
            }
            frag.appendChild(empty);
        }

        root.querySelector('.crack-lg-groups').replaceChildren(frag);

        // 상태 문구
        const status = root.querySelector('.crack-lg-status');
        let statusText = '';
        if (archiveSearchState.status === 'indexing') {
            statusText = items.length ? '목록을 최신으로 갱신하는 중' : '목록을 불러오는 중';
        } else if (archiveSearchState.status === 'error') {
            statusText = items.length ? '최신화 실패, 저장된 목록을 보여주는 중' : `불러오기 실패: ${archiveSearchState.lastError || '알 수 없는 오류'}`;
        } else if (archiveSearchState.partial) {
            statusText = '최대 수집 한도까지만 보여주는 중';
        }
        status.textContent = statusText;
        status.classList.toggle('is-on', !!statusText);
        status.classList.toggle('is-busy', archiveSearchState.status === 'indexing');

        root.querySelector('.crack-lg-sub').textContent = filtered
            ? `${items.length.toLocaleString()}개 중 ${shown.toLocaleString()}개`
            : `${items.length.toLocaleString()}개 채팅`;

        renderLoungeColorFilter(root, themeColors);

        const seg = root.querySelector('.crack-lg-seg[data-seg="view"]');
        seg.style.setProperty('--i', loungeState.view === 'dense' ? '1' : '0');
        seg.querySelectorAll('button').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.view === loungeState.view));
        });
        const groupSeg = root.querySelector('.crack-lg-seg[data-seg="group"]');
        groupSeg.style.setProperty('--i', byColor ? '1' : '0');
        groupSeg.querySelectorAll('button').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.group === loungeState.group));
        });
        root.classList.toggle('is-by-color', byColor);
        root.querySelector('.crack-lg-rail').setAttribute('aria-label', byColor ? '색상 고르기' : '보관함 고르기');
        root.classList.toggle('is-dense', loungeState.view === 'dense');
        root.classList.toggle('is-selecting', loungeState.selecting);
        updateLoungeFolderTools(root);

        loungeState.lastSig = getLoungeSig();
        playLoungeAnim(mode);
    }

    // 1.4.1: 색 거르기는 평소 「전체」(또는 고른 색) 하나만 보이고, 누르면 색 점이 펼쳐진다.
    function renderLoungeColorFilter(root, themeColors = getThemeColors()) {
        const box = root?.querySelector('.crack-lg-colors');
        const list = box?.querySelector('.crack-lg-cf-list');
        const pill = box?.querySelector('.crack-lg-cf.is-all');
        if (!box || !list || !pill) return;
        if (loungeState.color && !colorValues[loungeState.color]) loungeState.color = '';
        const keys = Object.keys(colorValues);
        const sig = `${keys.join(',')}|${colorVersion}|${document.body.getAttribute('data-theme') || ''}`;
        if (list.dataset.sig !== sig) {
            list.dataset.sig = sig;
            const dots = keys.map((key, index) => {
                const dot = ctEl('button', 'crack-lg-cf');
                dot.type = 'button';
                dot.dataset.k = key;
                dot.style.setProperty('--d', themeColors.accents?.[key] || colorValues[key]);
                dot.style.setProperty('--n', String(index));
                dot.title = `${colorLabel(key)}만 보기`;
                dot.setAttribute('aria-label', dot.title);
                return dot;
            });
            const add = ctEl('button', 'crack-lg-cf-add');
            add.type = 'button';
            add.dataset.colorAdd = 'filter';
            add.title = '색 추가';
            add.setAttribute('aria-label', '색 추가');
            add.style.setProperty('--n', String(keys.length));
            add.innerHTML = ctSvg('<path d="M12 6v12M6 12h12"/>', 13);
            list.replaceChildren(...dots, add);
        }
        const open = !!loungeState.colorsOpen;
        const active = loungeState.color;
        list.querySelectorAll('button').forEach(button => {
            button.tabIndex = open ? 0 : -1;
            if (!button.dataset.k) return;
            const on = button.dataset.k === active;
            button.classList.toggle('is-on', on);
            button.setAttribute('aria-pressed', String(on));
        });
        list.inert = !open;
        const showColor = !open && !!active;
        const pillSig = showColor ? `${active}|${colorLabel(active)}|${sig}` : 'all';
        if (pill.dataset.sig !== pillSig) {
            pill.dataset.sig = pillSig;
            if (showColor) {
                const mark = ctEl('i', 'crack-lg-cf-dot');
                mark.style.setProperty('--d', themeColors.accents?.[active] || colorValues[active]);
                pill.replaceChildren(mark, ctEl('span', '', colorLabel(active)));
            } else {
                pill.replaceChildren(ctEl('span', '', '전체'));
            }
        }
        pill.classList.toggle('is-on', !open || !active);
        pill.classList.toggle('has-color', showColor);
        pill.setAttribute('aria-expanded', String(open));
        pill.title = open ? '모든 색 보기' : '색으로 거르기';
        if (open) list.style.setProperty('--cf-w', `${list.scrollWidth + 4}px`);
        box.classList.toggle('is-open', open);
    }

    function setLoungeColorsOpen(open) {
        if (!!loungeState.colorsOpen === !!open) return;
        loungeState.colorsOpen = !!open;
        renderLoungeColorFilter(getLoungeRoot());
    }

    function updateLoungeFolderTools(root) {
        const count = loungeState.selected.size;
        root.querySelector('.crack-lg-selected-count').textContent = `${count}개 선택`;
        const select = root.querySelector('[data-folder-tool="select"]');
        select.classList.toggle('is-on', loungeState.selecting);
        select.setAttribute('aria-pressed', String(loungeState.selecting));
        const selectLabel = loungeState.selecting ? '선택 끝내기' : '채팅방 골라서 폴더에 넣기';
        select.title = selectLabel;
        select.setAttribute('aria-label', selectLabel);
        const all = root.querySelector('[data-folder-tool="all"]');
        const allPicked = loungeState.eligible.length > 0 && loungeState.eligible.every(key => loungeState.selected.has(key));
        all.textContent = allPicked ? '모두 선택됨' : `전체 선택 ${loungeState.eligible.length.toLocaleString()}`;
        all.disabled = !loungeState.eligible.length || allPicked;
        root.querySelector('[data-folder-tool="clear"]').disabled = !count;
        root.querySelector('[data-folder-tool="move"]').disabled = !count;
        const map = loadLocalMap();
        root.querySelector('[data-folder-tool="remove"]').disabled = ![...loungeState.selected].some(key => map[key]);
    }

    function onLoungeFolderTool(action, button) {
        if (action === 'select') {
            loungeState.selecting = !loungeState.selecting;
            if (!loungeState.selecting) loungeState.selected.clear();
        } else if (action === 'all') {
            loungeState.selecting = true;
            loungeState.eligible.forEach(key => loungeState.selected.add(key));
        } else if (action === 'clear') loungeState.selected.clear();
        else if (action === 'create') { openLocalFolderManager(true); return; }
        else if (action === 'manage') { openLocalFolderManager(false); return; }
        else if (action === 'move') {
            if (!loungeState.selected.size || !button) return;
            const rect = button.getBoundingClientRect();
            openLocalAssignMenu({
                x: rect.left, y: rect.bottom + 6,
                hrefs: [...loungeState.selected],
                onDone: () => { loungeState.selected.clear(); renderLounge(); }
            });
            return;
        } else if (action === 'remove') {
            if (!loungeState.selected.size) return;
            const count = loungeState.selected.size;
            setLocalFolderForKeys([...loungeState.selected], LOCAL_ROOT_ID);
            loungeState.selected.clear();
            showTunerToast(`${count}개를 폴더에서 뺐어요`);
        }
        renderLounge();
    }

    // 고를 때마다 전체를 다시 그리면 스크롤·애니메이션이 흔들리므로 해당 카드만 바꾼다.
    function toggleLoungeItemSelection(tile) {
        const key = localChatKey(tile?.dataset?.href);
        if (!key) return;
        const picked = !loungeState.selected.has(key);
        if (picked) loungeState.selected.add(key);
        else loungeState.selected.delete(key);
        tile.classList.toggle('is-picked', picked);
        tile.setAttribute('aria-pressed', String(picked));
        const root = getLoungeRoot();
        if (root) updateLoungeFolderTools(root);
    }

    // 끌어다 놓기: 카드 → 왼쪽 레일의 내 폴더/색상. 고른 카드를 끌면 고른 것 전부를 옮긴다.
    function bindLoungeDrag(root) {
        let draggingKeys = [];
        const dropTarget = event => {
            const button = event.target.closest?.('.crack-lg-rail-btn');
            if (!button) return null;
            if (button.dataset.colorView && button.dataset.colorView !== 'all') return button;
            if (button.dataset.folder?.startsWith('local:')) return button;
            return null;
        };
        const clear = () => root.querySelectorAll('.is-drop, .is-dragging').forEach(el => el.classList.remove('is-drop', 'is-dragging'));
        root.addEventListener('dragstart', event => {
            const tile = event.target.closest?.('.crack-lg-tile');
            if (!tile || !event.dataTransfer) return;
            const key = localChatKey(tile.dataset.href);
            draggingKeys = loungeState.selecting && loungeState.selected.has(key) ? [...loungeState.selected] : [key];
            event.dataTransfer.effectAllowed = 'copyMove';
            event.dataTransfer.setData(CHAT_DRAG_TYPE, JSON.stringify(draggingKeys));
            event.dataTransfer.setData('text/uri-list', new URL(tile.dataset.href, location.origin).href);
            closeLoungePop();
            requestAnimationFrame(() => {
                root.querySelectorAll('.crack-lg-tile').forEach(other => {
                    if (draggingKeys.includes(localChatKey(other.dataset.href))) other.classList.add('is-dragging');
                });
            });
        });
        root.addEventListener('dragend', () => { draggingKeys = []; clear(); });
        root.addEventListener('dragover', event => {
            const target = dropTarget(event);
            if (!target || !isChatDrag(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            if (!target.classList.contains('is-drop')) {
                root.querySelectorAll('.crack-lg-rail-btn.is-drop').forEach(el => el.classList.remove('is-drop'));
                target.classList.add('is-drop');
            }
        });
        root.addEventListener('dragleave', event => {
            const target = dropTarget(event);
            if (target && !target.contains(event.relatedTarget)) target.classList.remove('is-drop');
        });
        root.addEventListener('drop', event => {
            const target = dropTarget(event);
            if (!target) return;
            const keys = readDraggedChatKeys(event);
            clear();
            if (!keys.length) return;
            event.preventDefault();
            const done = target.dataset.colorView
                ? dropChatsInto(keys, { color: target.dataset.colorView === 'none' ? '' : target.dataset.colorView })
                : dropChatsInto(keys, { folderId: target.dataset.folder.slice(6) });
            if (done && loungeState.selecting) { loungeState.selected.clear(); renderLounge(); }
        });
    }

    function startColorRename(button) {
        const key = button.dataset.colorRename;
        const head = button.closest('.crack-lg-gh');
        const label = head?.querySelector('strong');
        if (!key || !label) return;
        const input = ctEl('input', 'crack-lg-gh-input');
        input.type = 'text';
        input.maxLength = 20;
        input.value = colorLabel(key);
        input.placeholder = DEFAULT_COLOR_LABELS[key];
        input.setAttribute('aria-label', '색상 이름');
        let done = false;
        const finish = save => {
            if (done) return;
            done = true;
            if (save) saveColorLabel(key, input.value);
            renderLounge();
            renderLocalFolderBar();
        };
        input.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); finish(true); }
            if (event.key === 'Escape') { event.preventDefault(); finish(false); }
        });
        input.addEventListener('blur', () => finish(true));
        label.replaceWith(input);
        button.hidden = true;
        input.focus();
        input.select();
    }

    function openLoungeItem(tile) {
        if (loungeState.selecting) { toggleLoungeItemSelection(tile); return; }
        const href = tile?.dataset?.href;
        if (href) location.href = href;
    }

    function closeLoungePop() {
        const root = getLoungeRoot();
        if (!root) return;
        root.querySelector('.crack-lg-pop')?.classList.remove('is-open');
        root.querySelectorAll('.crack-lg-tile.is-menu').forEach(tile => tile.classList.remove('is-menu'));
        root.querySelectorAll('.crack-lg-more[aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
        loungeState.popChatId = '';
    }

    function openLoungePop(button) {
        const root = getLoungeRoot();
        const pop = root?.querySelector('.crack-lg-pop');
        const tile = button.closest('.crack-lg-tile');
        if (!pop || !tile) return;

        if (loungeState.popChatId && loungeState.popChatId === tile.dataset.chatId) {
            closeLoungePop();
            return;
        }
        closeLoungePop();
        loungeState.popChatId = tile.dataset.chatId || '';

        const current = readChatColorById(loungeState.popChatId);
        const accents = getThemeColors().accents || {};
        const colorRow = ctEl('div', 'crack-lg-pop-row');
        colorRow.append(ctEl('span', 'crack-lg-pop-label', '색상'));
        Object.keys(colorValues).forEach(key => {
            const dot = ctEl('button', 'crack-lg-pop-dot');
            dot.type = 'button';
            dot.dataset.k = key;
            dot.style.setProperty('--d', accents[key] || colorValues[key]);
            dot.classList.toggle('is-on', current === key);
            dot.title = `${colorLabel(key)} 색상 ${current === key ? '제거' : '적용'}`;
            dot.setAttribute('aria-label', dot.title);
            colorRow.appendChild(dot);
        });
        const popAdd = ctEl('button', 'crack-lg-pop-add');
        popAdd.type = 'button';
        popAdd.title = '색 추가';
        popAdd.setAttribute('aria-label', '색 추가');
        popAdd.innerHTML = ctSvg('<path d="M12 6v12M6 12h12"/>', 13);
        colorRow.appendChild(popAdd);
        pop.replaceChildren(colorRow);

        const href = tile.dataset.href || '';
        const folderId = loadLocalMap()[localChatKey(href)] || LOCAL_ROOT_ID;
        const folder = folderId === LOCAL_ROOT_ID ? null : loadLocalFolders().find(entry => entry.id === folderId);
        const folderButton = ctEl('button', 'crack-lg-pop-folder');
        folderButton.type = 'button';
        folderButton.setAttribute('role', 'menuitem');
        if (folder) folderButton.style.setProperty('--folder-color', folder.color);
        const folderIcon = ctEl('span');
        folderIcon.innerHTML = CT_ICON.folder;
        folderButton.append(folderIcon, ctEl('b', '', folder ? '폴더 옮기기' : '폴더에 넣기'));
        if (folder) folderButton.append(ctEl('em', '', folder.name));
        pop.append(ctEl('div', 'crack-lg-pop-sep'), folderButton);

        const rootRect = root.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const width = pop.offsetWidth;
        const height = pop.offsetHeight;
        let top = buttonRect.bottom - rootRect.top + 6;
        let side = 'bottom';
        if (top + height > root.clientHeight - 8) {
            top = buttonRect.top - rootRect.top - height - 6;
            side = 'top';
        }
        const left = Math.max(8, Math.min(buttonRect.right - rootRect.left - width, root.clientWidth - width - 8));
        pop.dataset.side = side;
        pop.style.top = `${Math.max(8, top)}px`;
        pop.style.left = `${left}px`;

        tile.classList.add('is-menu');
        button.setAttribute('aria-expanded', 'true');
        requestAnimationFrame(() => pop.classList.add('is-open'));
    }

    function onLoungeClick(event) {
        const target = event.target;
        let el;

        if ((el = target.closest('[data-folder-tool]'))) {
            onLoungeFolderTool(el.dataset.folderTool, el);
            return;
        }
        if ((el = target.closest('.crack-lg-pop-folder'))) {
            const tile = getLoungeRoot()?.querySelector('.crack-lg-tile.is-menu');
            const pop = el.closest('.crack-lg-pop');
            const rect = pop.getBoundingClientRect();
            closeLoungePop();
            if (tile) openLocalAssignMenu({ x: rect.left, y: rect.top, hrefs: [tile.dataset.href], title: tile.querySelector('.crack-lg-title')?.textContent });
            return;
        }
        if ((el = target.closest('[data-color-rename]'))) {
            startColorRename(el);
            return;
        }
        if (target.closest('.crack-lg-gh-input')) return;

        if ((el = target.closest('.crack-lg-pop-add'))) {
            const chatId = loungeState.popChatId;
            pickCustomColor(el, key => {
                if (chatId) saveColor('episode_' + chatId, key);
                closeLoungePop();
                loungeState.lastSig = '';
                renderLounge('swap');
            });
            return;
        }
        if ((el = target.closest('.crack-lg-pop-dot'))) {
            const chatId = loungeState.popChatId;
            if (chatId) {
                const key = el.dataset.k;
                const current = readChatColorById(chatId);
                saveColor('episode_' + chatId, key && current !== key ? key : null);
            }
            const root = getLoungeRoot();
            const chosen = readChatColorById(chatId);
            const tile = root?.querySelector('.crack-lg-tile.is-menu');
            if (tile) {
                const colors = getThemeColors();
                if (chosen) tile.dataset.color = chosen;
                else delete tile.dataset.color;
                tile.style.setProperty('--c', colors.accents?.[chosen] || 'transparent');
                tile.style.setProperty('--cbg', colors.backgrounds?.[chosen] || 'transparent');
            }
            root?.querySelectorAll('.crack-lg-pop-dot').forEach(dot => {
                const selected = dot.dataset.k === chosen;
                dot.classList.toggle('is-on', selected);
                dot.setAttribute('aria-pressed', String(selected));
            });
            loungeState.lastSig = ''; // Reconcile filters after the palette closes.
            return;
        }
        if ((el = target.closest('.crack-lg-more'))) {
            event.stopPropagation();
            openLoungePop(el);
            return;
        }
        if (!target.closest('.crack-lg-pop')) closeLoungePop();

        if (target.closest('.crack-lg-close')) {
            closeLounge();
            return;
        }
        if ((el = target.closest('.crack-lg-clear'))) {
            const input = getLoungeRoot()?.querySelector('.crack-lg-search input');
            if (input) {
                input.value = '';
                input.focus({ preventScroll: true });
            }
            el.classList.remove('is-on');
            clearTimeout(loungeState.queryTimer);
            loungeState.query = '';
            renderLounge('swap');
            return;
        }
        if ((el = target.closest('[data-color-add]'))) {
            const from = el.dataset.colorAdd;
            pickCustomColor(el, key => {
                if (from === 'filter') {
                    loungeState.color = key;
                    loungeState.colorsOpen = false;
                } else if (from === 'rail') {
                    loungeState.colorView = key;
                }
                loungeState.lastSig = '';
                renderLounge('swap');
                showTunerToast(`「${colorLabel(key)}」 색을 추가했어요`);
            });
            return;
        }
        if ((el = target.closest('[data-color-delete]'))) {
            const key = el.dataset.colorDelete;
            if (!el.classList.contains('is-armed')) {
                el.classList.add('is-armed');
                el.title = '한 번 더 누르면 지워져요';
                showTunerToast(`한 번 더 누르면 「${colorLabel(key)}」 색을 지워요`);
                setTimeout(() => {
                    if (!el.isConnected) return;
                    el.classList.remove('is-armed');
                    el.title = '이 색 지우기';
                }, 3000);
                return;
            }
            const name = colorLabel(key);
            removeCustomColor(key);
            if (loungeState.color === key) loungeState.color = '';
            if (loungeState.colorView === key) loungeState.colorView = 'all';
            loungeState.lastSig = '';
            renderLounge('swap');
            scheduleUpdate();
            showTunerToast(`「${name}」 색을 지웠어요`);
            return;
        }
        if ((el = target.closest('.crack-lg-cf'))) {
            const key = el.dataset.k || '';
            if (!key) {
                if (!loungeState.colorsOpen) {
                    setLoungeColorsOpen(true);
                    return;
                }
                if (!loungeState.color) {
                    setLoungeColorsOpen(false);
                    return;
                }
                loungeState.colorsOpen = false;
                loungeState.color = '';
                renderLounge('swap');
                return;
            }
            loungeState.color = loungeState.color !== key ? key : '';
            loungeState.colorsOpen = false;
            renderLounge('swap');
            return;
        }
        if ((el = target.closest('.crack-lg-seg button[data-group]'))) {
            const group = el.dataset.group === 'color' ? 'color' : 'folder';
            if (group !== loungeState.group) {
                loungeState.group = group;
                try { localStorage.setItem(LOUNGE_GROUP_KEY, group); } catch (e) {}
                const scroller = getLoungeRoot()?.querySelector('.crack-lg-scroll');
                if (scroller) scroller.scrollTop = 0;
                renderLounge('swap');
            }
            return;
        }
        if ((el = target.closest('.crack-lg-seg button'))) {
            const view = el.dataset.view === 'dense' ? 'dense' : 'grid';
            if (view !== loungeState.view) {
                loungeState.view = view;
                try { localStorage.setItem(LOUNGE_VIEW_KEY, view); } catch (e) {}
                renderLounge('swap');
            }
            return;
        }
        if ((el = target.closest('.crack-lg-rail-btn'))) {
            if (el.dataset.colorView) loungeState.colorView = el.dataset.colorView;
            else loungeState.folder = el.dataset.folder || 'all';
            const scroller = getLoungeRoot()?.querySelector('.crack-lg-scroll');
            if (scroller) scroller.scrollTop = 0;
            renderLounge('swap');
            return;
        }
        if ((el = target.closest('[data-lg-more]'))) {
            loungeState.expanded.add(el.dataset.lgMore);
            renderLounge();
            return;
        }
        if (target.closest('[data-lg-reset]')) {
            loungeState.folder = 'all';
            loungeState.colorView = 'all';
            loungeState.color = '';
            loungeState.query = '';
            const input = getLoungeRoot()?.querySelector('.crack-lg-search input');
            if (input) input.value = '';
            getLoungeRoot()?.querySelector('.crack-lg-clear')?.classList.remove('is-on');
            renderLounge('swap');
            return;
        }
        if ((el = target.closest('.crack-lg-tile'))) {
            openLoungeItem(el);
        }
    }

    function onLoungeInput(event) {
        const input = event.target.closest?.('.crack-lg-search input');
        if (!input) return;
        input.closest('.crack-lg-search')?.querySelector('.crack-lg-clear')?.classList.toggle('is-on', !!input.value.trim());
        clearTimeout(loungeState.queryTimer);
        loungeState.queryTimer = setTimeout(() => {
            loungeState.query = input.value || '';
            renderLounge();
        }, 80);
    }

    function openLounge() {
        if (loungeState.open) return;
        const searchContainer = document.querySelector('.crack-search-container');
        if (!searchContainer) return;

        const root = ensureLounge();
        positionLounge(root, searchContainer);
        loungeState.open = true;
        root.inert = false;
        root.setAttribute('aria-hidden', 'false');
        document.querySelectorAll('.crack-lounge-btn').forEach(button => button.setAttribute('aria-expanded', 'true'));

        renderLounge();
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!loungeState.open) return;
            root.classList.add('is-open');
            playLoungeAnim('enter');
        }));

        // 목록이 비었거나 오래됐으면 뒤에서 새로 모으고, 끝나면 다시 그린다.
        ensureArchiveSearchIndex();
        const inFlight = archiveSearchState.inFlight;
        if (inFlight) inFlight.then(() => renderLounge()).catch(() => {});

        clearInterval(loungeState.pollTimer);
        loungeState.pollTimer = setInterval(() => {
            if (!loungeState.open || loungeState.popChatId || root.querySelector('.crack-lg-gh-input')) return;
            if (getLoungeSig() !== loungeState.lastSig) renderLounge();
        }, 900);

        setTimeout(() => {
            if (loungeState.open) root.querySelector(isMobileLounge() ? '.crack-lg-close' : '.crack-lg-search input')?.focus({ preventScroll: true });
        }, 380);
    }

    function closeLounge() {
        if (!loungeState.open) return;
        const root = getLoungeRoot();
        const hadFocus = !!root?.contains(document.activeElement);

        loungeState.open = false;
        loungeState.selecting = false;
        loungeState.selected.clear();
        closeLocalAssignMenu();
        // 한눈에 보기에서 바꾼 색이 사이드바 색상 모아보기에도 반영되게 한다.
        renderLocalFolderBar();
        clearInterval(loungeState.pollTimer);
        loungeState.pollTimer = 0;
        closeLoungePop();
        root?.classList.remove('is-open');
        document.querySelectorAll('.crack-lounge-btn').forEach(button => button.setAttribute('aria-expanded', 'false'));
        if (hadFocus) {
            document.activeElement?.blur();
            document.querySelector('.crack-lounge-btn')?.focus({ preventScroll: true });
        }
        if (root) { root.inert = true; root.setAttribute('aria-hidden', 'true'); }
    }

    document.addEventListener('click', event => {
        const button = event.target.closest?.('.crack-lounge-btn');
        if (!button) return;
        event.preventDefault();
        if (loungeState.open) closeLounge();
        else openLounge();
    });

    document.addEventListener('pointerdown', event => {
        if (loungeState.popChatId && !event.target.closest?.('.crack-lg-pop, .crack-lg-more')) closeLoungePop();
        if (loungeState.colorsOpen && !event.target.closest?.('.crack-lg-colors')) setLoungeColorsOpen(false);
    }, true);

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !loungeState.open || smartOrganizeState.open) return;
        if (event.isComposing) return;
        if (loungeState.colorsOpen) {
            setLoungeColorsOpen(false);
            return;
        }
        if (loungeState.popChatId) {
            closeLoungePop();
            return;
        }
        closeLounge();
    });

    window.addEventListener('resize', () => {
        if (!loungeState.open) return;
        closeLoungePop();
        positionLounge(getLoungeRoot(), document.querySelector('.crack-search-container'));
    }, { passive: true });

    let loungeViewportFrame = 0;
    function updateLoungeViewport() {
        if (!loungeState.open || loungeViewportFrame) return;
        loungeViewportFrame = requestAnimationFrame(() => {
            loungeViewportFrame = 0;
            if (!loungeState.open) return;
            closeLoungePop();
            positionLounge(getLoungeRoot(), document.querySelector('.crack-search-container'));
        });
    }
    window.visualViewport?.addEventListener('resize', updateLoungeViewport, { passive: true });
    window.visualViewport?.addEventListener('scroll', updateLoungeViewport, { passive: true });

    function refreshChatItem(container) {
        const id = getChatId(container);
        if (!id) return;

        container.classList.add('crack-chat-item');
        container.dataset.crackChatId = id;

        let saved = null;
        try {
            saved = localStorage.getItem(STORAGE_KEY + id);
        } catch (e) {
            console.warn("[Crack UI] LocalStorage 읽기 실패:", e);
        }

        const current = isCurrentChat(container);
        const theme = document.body.getAttribute('data-theme') || 'dark';
        const visualKey = `${id}|${saved || ''}|${current ? '1' : '0'}|${theme}`;

        if (chatVisualCache.get(container) !== visualKey) {
            applyVisualColor(container, saved || null);
            markCurrentChat(container);
            chatVisualCache.set(container, visualKey);
        }

        setupMarquee(container);
    }

    // 핵심 통합 UI 리프레시 엔진 (React 렌더링 동시성 제어)
    function updateUI() {
        if (isUpdatingUI || !tunerUiStarted) return;
        if (!findArchiveHeaderSpan() && !findChatListHeaderSpan()) return;

        // 열린 Radix 메뉴의 포커스/선택 수명주기를 보존한다.
        // 메뉴가 닫힌 뒤 실제 목록 변화가 생기면 MutationObserver가 다시 갱신한다.
        if (isChatMenuOpen()) return;

        isUpdatingUI = true;

        try {
            // 1. 검색창 및 보관함/채팅 목록 개수 주입
            injectSearchBar();
            renderLocalFolderBar();
            ensureArchiveCount();
            scheduleSearchOverlayPositionUpdate();

            // 2. 채팅방/보관함 컬러 세팅 및 커스텀 UI 적용
            getChatContainers().forEach(refreshChatItem);

            // 3. 보관함 높이 리사이저 핸들 세팅
            setupResizer();

            // 4. 검색 필터 유지 보완
            const searchInput = document.querySelector('.crack-search-input');
            if (searchInput) {
                syncSearchInputFromState(searchInput, document.querySelector('.crack-search-clear'));
                const query = getCurrentSearchQuery();

                // 검색 중 MutationObserver가 계속 updateUI를 부르며 타자를 끊지 않도록,
                // 실제 검색 적용은 입력 디바운스 타이머에 맡긴다.
                if (!query) {
                    filterChatsAndFolders('');
                } else if (!searchDebounceTimer) {
                    scheduleSearchQueryApply(SEARCH_DEBOUNCE_MS);
                }
            }
        } catch (error) {
            console.error("[Crack UI] updateUI 과정 중 오류 발생:", error);
        } finally {
            isUpdatingUI = false;
        }
    }

    function scheduleUpdate() {
        if (updateTimer) return;
        updateTimer = setTimeout(() => { updateTimer = null; updateUI(); }, 80);
    }

    function setupResizer() {
        const { divider, archiveContainer } = getArchivePartsCached();
        if (!divider || !archiveContainer) return;

        // 매번 빠르게 재적용한다. divider가 이미 핸들 처리되어 있어도 새 컨테이너가 생길 수 있다.
        const savedHeight = readSavedArchiveHeight() || ARCHIVE_HEIGHT_DEFAULT;
        applyArchiveScrollBox(archiveContainer, savedHeight);

        if (divider.classList.contains('crack-resizer-handle')) return;

        divider.classList.add('crack-resizer-handle');

        divider.addEventListener('mousedown', e => {
            e.preventDefault();

            const liveContainer = isLiveArchiveContainer(cachedArchiveContainer)
                ? cachedArchiveContainer
                : getArchivePartsCached().archiveContainer;
            if (!liveContainer) return;

            const startY = e.clientY;
            const startH = Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue('--crack-archive-h'), 10) ||
                liveContainer.offsetHeight ||
                ARCHIVE_HEIGHT_DEFAULT;

            const onMouseMove = ev => {
                const newH = Math.max(ARCHIVE_HEIGHT_MIN, startH + (ev.clientY - startY));
                setArchiveHeightValue(newH);
                applyArchiveScrollBox(liveContainer, newH);
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove, true);
                document.removeEventListener('mouseup', onMouseUp, true);
            };

            document.addEventListener('mousemove', onMouseMove, true);
            document.addEventListener('mouseup', onMouseUp, true);
        }, true);
    }

    let lastKnownPathname = location.pathname;
    let countRefreshTimer = null;
    let countFollowupTimer = null;

    function scheduleCountRefresh(force = true) {
        clearTimeout(countRefreshTimer);
        clearTimeout(countFollowupTimer);

        countRefreshTimer = setTimeout(() => {
            countRefreshTimer = null;
            ensureArchiveCount(force);

            // 생성/이동 직후 서버 집계 반영이 늦는 경우를 위해 한 번 더 확인한다.
            countFollowupTimer = setTimeout(() => {
                countFollowupTimer = null;
                ensureArchiveCount(true);
            }, 2200);
        }, 700);
    }

    // 실시간 페이지 변화(DOM Mutation) 감시
    const observer = new MutationObserver(mutations => {
        let relevant = false;
        const pathnameChanged = location.pathname !== lastKnownPathname;
        if (pathnameChanged) { lastKnownPathname = location.pathname; relevant = true; }
        rsOnPageChange(pathnameChanged);
        // Resolve cached headers once per delivery, never once per changed text node.
        const headers = [...sectionHeaderCache.values()].filter(el => el.isConnected);
        for (const mutation of mutations) {
            const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
            if (!target || target.closest(OWN_TUNER_UI + ', ' + NON_LIST_CONTENT)) continue;
            if (mutation.type === 'attributes') {
                if (target === document.body) relevant = true;
                continue;
            }
            const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
            const ownAddition = !mutation.removedNodes.length && mutation.addedNodes.length && [...mutation.addedNodes].every(n => n instanceof Element && n.matches(OWN_TUNER_UI));
            if (ownAddition) continue;
            const closestMenu = target.closest('[role="menu"]');
            if (closestMenu) queueMenuInjection(closestMenu);
            for (const node of nodes) {
                if (!(node instanceof Element)) continue;
                if (node.matches(NON_LIST_CONTENT)) continue;
                if (node.matches('[role="menu"]')) {
                    if (node.isConnected) queueMenuInjection(node);
                    else relevant = true;
                }
                if (node.isConnected) node.querySelectorAll('[role="menu"]').forEach(queueMenuInjection);
                else if (node.querySelector('[role="menu"]')) relevant = true;
                if (cachedArchiveContainer && node.contains(cachedArchiveContainer) && !node.isConnected) resetArchiveCache();
                if (nodeTouchesList(node)) relevant = true;
            }
            // Header/sidebar changes matter; chat streaming and foreign decorations do not.
            if (headers.some(h => h.parentElement?.parentElement?.contains(target))) relevant = true;
        }
        if (relevant) {
            scheduleArchiveHeightFastApply();
            scheduleUpdate();
        }
    });
    // 핫픽스: DOM이 완전히 빌드되기 전 observer가 실행되어 스크립트 전체가 사망하는 구조적 결함 원천 해결
    // UI Plus 2.6.3 keeps its auto-close timer private and checks only :hover.
    // Extend that check on its TWO marked elements, never Element.prototype.
    // Native clicks, React handlers, menu focus and the user's auto-hide setting stay intact.
    function installUiPlusInteractionGuard() {
        const PANEL = '[data-crack-ui-chat-list-panel="1"]';
        const ZONE = '#crack-ui-chat-list-zone';
        const OWN = '#crack-lounge, #crack-local-folders, #crack-folder-results, #crack-folder-manager, #crack-local-assign, .crack-so, .crack-lounge-btn, .crack-search-container, #crack-search-overlay, #crack-smart-organize-modal, .custom-palette-container, .crack-smart-organize-menu-item, .crack-resizer-handle';
        const nativeMatches = Element.prototype.matches;
        const patched = new Map();
        const dialogs = new Set();
        let graceUntil = 0;
        let dialogIntentUntil = 0;
        let dragging = false;
        let outside = false;
        let wasHeld = false;
        let timer = null;
        let queued = false;
        let discoveryNeeded = true;

        const visible = el => !!el?.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
        const panelFor = el => el instanceof Element ? el.closest(PANEL) : null;
        const owned = el => el instanceof Element && !!el.closest(OWN);
        function relatedMenu(menu) {
            return (menu.getAttribute('aria-labelledby') || '').split(/\s+/).some(id => {
                const trigger = document.getElementById(id);
                return panelFor(trigger) || owned(trigger);
            }) || !!menu.querySelector('.custom-palette-container, .crack-smart-organize-menu-item');
        }
        function related(el) {
            if (!(el instanceof Element)) return false;
            if (owned(el) || panelFor(el) || el.closest(ZONE)) return true;
            const menu = el.closest('[role="menu"]');
            if (menu && relatedMenu(menu)) return true;
            return [...dialogs].some(d => visible(d) && d.contains(el));
        }
        function held() {
            if (smartOrganizeState.open || loungeState.open || searchResultsOpen || dragging) return true;
            for (const dialog of dialogs) {
                if (!visible(dialog)) dialogs.delete(dialog);
                else return true;
            }
            if ([...document.querySelectorAll('[role="menu"][data-state="open"]')].some(m => visible(m) && relatedMenu(m))) return true;
            if (outside) return false;
            const focused = document.activeElement;
            if (related(focused) && focused.matches('input, textarea, select, [contenteditable="true"]')) return true;
            if ([...document.querySelectorAll(OWN)].some(el => visible(el) && nativeMatches.call(el, ':hover'))) return true;
            return Date.now() < graceUntil;
        }
        function restore(el, entry) {
            if (el.matches !== entry.wrapper) return;
            if (entry.descriptor) Object.defineProperty(el, 'matches', entry.descriptor);
            else delete el.matches;
        }
        function sync() {
            queued = false;
            if (discoveryNeeded) {
            discoveryNeeded = false;
            for (const [el, entry] of patched) {
                if (!el.isConnected || !nativeMatches.call(el, PANEL + ', ' + ZONE)) {
                    restore(el, entry);
                    patched.delete(el);
                }
            }
            for (const el of document.querySelectorAll(PANEL + ', ' + ZONE)) {
                if (patched.has(el)) continue;
                const original = el.matches;
                const descriptor = Object.getOwnPropertyDescriptor(el, 'matches');
                const wrapper = function(selector) {
                    if (this === el && selector === ':hover' && held()) return true;
                    return original.call(this, selector);
                };
                try {
                    Object.defineProperty(el, 'matches', { configurable: true, writable: true, value: wrapper });
                    patched.set(el, { wrapper, descriptor });
                } catch { /* An incompatible owner must not stop the tuner. */ }
            }
            }
            const active = patched.size > 0 && held();
            if (wasHeld && !active) {
                // UI Plus's previous timeout may have expired while we held it.
                // Re-arm its normal timeout once; do not click/toggle the panel.
                for (const el of patched.keys()) {
                    if (visible(el) && !nativeMatches.call(el, ':hover')) {
                        el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
                    }
                }
            }
            wasHeld = active;
            clearTimeout(timer);
            timer = active ? setTimeout(sync, 120) : null;
        }
        function queue() {
            if (queued) return;
            queued = true;
            queueMicrotask(sync);
        }
        document.addEventListener('pointerdown', event => {
            if (!patched.size) return;
            outside = !related(event.target);
            if (!outside) {
                graceUntil = Date.now() + 450;
                dialogIntentUntil = Date.now() + 1200;
                dragging = !!event.target.closest('.crack-resizer-handle');
            } else {
                graceUntil = 0;
                dialogIntentUntil = 0;
            }
            queue();
        }, true);
        for (const type of ['pointerup', 'pointercancel', 'mouseup']) {
            document.addEventListener(type, () => {
                if (!patched.size) return;
                if (dragging) graceUntil = Date.now() + 300;
                dragging = false;
                queue();
            }, true);
        }
        for (const type of ['focusin', 'focusout', 'pointerover', 'pointerout', 'input', 'keydown', 'click']) {
            document.addEventListener(type, event => {
                if (!patched.size) return;
                if (related(event.target)) {
                    if (type !== 'focusout' && type !== 'pointerout') outside = false;
                    graceUntil = Date.now() + 350;
                    if (type === 'click' || type === 'keydown') dialogIntentUntil = Date.now() + 1200;
                    queue();
                }
            }, true);
        }
        window.addEventListener('blur', () => {
            if (!patched.size) return;
            dragging = false;
            outside = true;
            graceUntil = 0;
            queue();
        });
        const observer = new MutationObserver(records => {
            let relevant = false;
            for (const record of records) {
                if (record.type === 'attributes') { relevant = true; continue; }
                const owner = record.target instanceof Element ? record.target : record.target?.parentElement;
                if (owner?.closest(OWN + ', ' + NON_LIST_CONTENT)) continue;
                for (const node of [...record.addedNodes, ...record.removedNodes]) {
                    if (!(node instanceof Element)) continue;
                    const selector = patched.size ? PANEL + ', ' + ZONE + ', ' + OWN + ', [role="menu"], [role="dialog"]' : PANEL + ', ' + ZONE;
                    if (node.matches(selector) || node.querySelector(selector)) relevant = true;
                    if (node.isConnected && Date.now() < dialogIntentUntil) {
                        const candidates = [...node.querySelectorAll('[role="dialog"]')];
                        if (node.matches('[role="dialog"]')) candidates.push(node);
                        candidates.forEach(d => { if (visible(d)) dialogs.add(d); });
                    }
                }
            }
            if (relevant) { discoveryNeeded = true; queue(); }
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-crack-ui-chat-list-panel'] });
        sync();
    }


    // ───────── 이 방에서 찾기 (1.5.0: 「크랙 채팅방 내부 검색」 1.4.2를 합쳤다) ─────────
    // 평소에는 전송 버튼 옆 돋보기만 둔다. 방에 들어올 때 창을 열지 않는다.
    // 열면 크랙 API로 이 방의 로그를 받아 브라우저 DB(IndexedDB)에 보관하고, 다음부터는 최근 부분만 다시 받는다.
    // PC는 오른쪽 결과 패널, 모바일은 입력창 위 카드(목록 보기를 누르면 위로 늘어남)로 같은 검색을 보여준다.
    // 1.6.0: 원작 2.0.2(lavielaviechu)의 북마크, 메시지 안 차례 이동, 도착 깜빡임, 더 똑똑한 이동을 우리 화면에 맞춰 가져왔다.
    const RS_DB_NAME = 'crack-tuner-room-search';
    const RS_STORE = 'rooms';
    const RS_KEEP_ROOMS = 20;
    const RS_SORT_KEY = 'crack-story-search-start-from-first'; // 1.4.2의 「첫 결과부터」 설정을 이어받는다.
    const RS_ALL_HL = 'crack-story-search-loader-all';
    const RS_CUR_HL = 'crack-story-search-loader-current';
    const RS_API = 'https://crack-api.wrtn.ai/crack-gen/v3/chats/';
    const RS_PAGE_LIMITS = [500, 200, 100];
    const RS_PAGE_GAP_MS = 120;
    const RS_RESULT_STEP = 150;
    const RS_DB_VERSION = 2;
    const RS_BM_STORE = 'bookmarks';
    const RS_BM_SORT_KEY = 'crack-tuner-bookmark-sort';
    const RS_TURN_LINE = /^\[?\s*T\s*(\d+)\s*(?:\]|$|[|〡·/])/i;
    const RS_ID = /^[a-f0-9]{24}$/i;
    const RS_STAR_PATH = 'M12 3.6l2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.6l-5.1 2.7.98-5.68L3.75 9.6l5.7-.83z';
    const rsStar = (size = 16, filled = true) => `<svg class="crs-star" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${RS_STAR_PATH}" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
    const RS_ICON = {
        up: ctSvg('<path d="m6 15 6-6 6 6"/>', 16),
        down: ctSvg('<path d="m6 9 6 6 6-6"/>', 16),
        refresh: ctSvg('<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>', 16),
        sort: ctSvg('<path d="M7 5v14M4 16l3 3 3-3M17 19V5M14 8l3-3 3 3"/>', 15),
        out: ctSvg('<path d="M7 17 17 7M9 7h8v8"/>', 15),
        launcher: ctSvg('<circle cx="10.75" cy="10.75" r="6.25"/><path d="M15.4 15.4 20 20"/>', 16),
        trash: ctSvg('<path d="M5 7h14"/><path d="M10 11v6M14 11v6"/><path d="M6.5 7l1 12h9l1-12"/><path d="M9.5 7V4.5h5V7"/>', 16),
        note: ctSvg('<path d="M6 4h12v16H6z"/><path d="M9 9h6M9 13h6M9 17h3"/>', 14)
    };
    const rs = {
        open: false, listOpen: false, chatId: '',
        messages: [], lastTurn: 0, rooted: false,
        loading: false, refreshing: false, complete: false, loadedCount: 0, error: '', abort: null, loadToken: 0,
        query: '', results: [], index: -1, expandedId: '', shown: RS_RESULT_STEP,
        filter: 'all', sort: 'new',
        jump: null, root: null, launcher: null, row: null,
        placeTimer: 0, positionFrame: 0, queryTimer: 0, hlObserver: null, hlTimer: 0, warned: false,
        tab: 'search', raw: [], byId: new Map(), byTurn: new Map(), replies: new Map(), msgById: new Map(),
        occ: null, notices: new Map(), domOnly: false, dbBlocked: false, menuGroupId: '',
        bm: { chatId: '', items: [], ids: new Set(), loading: null, loadingId: '' }, bmOpenId: '', bmEditId: '', bmSort: 'recent',
        marksTimer: 0, toastTimer: 0, moreObserver: null, flashTimer: 0, flashFade: 0, flashCleanup: null
    };

    function rsChatIdFromPath(path = location.pathname) {
        const match = /\/stories\/[^/]+\/episodes\/([a-f0-9]{24})/i.exec(String(path || ''));
        return match ? match[1].toLowerCase() : '';
    }

    function rsReadSort() {
        try { return localStorage.getItem(RS_SORT_KEY) === 'true' ? 'old' : 'new'; } catch (e) { return 'new'; }
    }

    function rsSaveSort() {
        try { localStorage.setItem(RS_SORT_KEY, String(rs.sort === 'old')); } catch (e) {}
    }

    function rsWait(ms, signal) {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
            const timer = setTimeout(resolve, ms);
            signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
        });
    }

    // ---------- 보관 (IndexedDB: 방마다 한 줄, 최근 20개 방만 남긴다) ----------
    let rsDbPromise = null;
    function rsDb() {
        if (!rsDbPromise) {
            rsDbPromise = new Promise(resolve => {
                try {
                    const request = indexedDB.open(RS_DB_NAME, RS_DB_VERSION);
                    request.onupgradeneeded = () => {
                        const db = request.result;
                        if (!db.objectStoreNames.contains(RS_STORE)) db.createObjectStore(RS_STORE, { keyPath: 'chatId' }).createIndex('savedAt', 'savedAt');
                        if (!db.objectStoreNames.contains(RS_BM_STORE)) db.createObjectStore(RS_BM_STORE, { keyPath: 'chatId' });
                    };
                    request.onsuccess = () => {
                        const db = request.result;
                        // 다음 버전이 DB를 올리려 하면 길을 비켜 준다.
                        db.onversionchange = () => db.close();
                        rs.dbBlocked = false;
                        resolve(db);
                    };
                    request.onerror = () => resolve(null);
                    // 옛 버전 튜너가 켜진 다른 탭이 DB를 붙잡고 있으면 잠깐 기다렸다가 이번에는 포기한다(다음에 다시 시도).
                    request.onblocked = () => {
                        rs.dbBlocked = true;
                        setTimeout(() => { rsDbPromise = null; resolve(null); }, 4000);
                    };
                } catch (e) {
                    resolve(null);
                }
            });
        }
        return rsDbPromise;
    }

    async function rsCacheGet(chatId) {
        const db = await rsDb();
        if (!db) return null;
        return new Promise(resolve => {
            try {
                const request = db.transaction(RS_STORE, 'readonly').objectStore(RS_STORE).get(chatId);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => resolve(null);
            } catch (e) {
                resolve(null);
            }
        });
    }

    async function rsCachePut(record) {
        const db = await rsDb();
        if (!db) return false;
        return new Promise(resolve => {
            try {
                const tx = db.transaction(RS_STORE, 'readwrite');
                const store = tx.objectStore(RS_STORE);
                store.put(record);
                const counting = store.count();
                counting.onsuccess = () => {
                    let extra = counting.result - RS_KEEP_ROOMS;
                    if (extra <= 0) return;
                    const cursor = store.index('savedAt').openKeyCursor();
                    cursor.onsuccess = () => {
                        const row = cursor.result;
                        if (!row || extra <= 0) return;
                        if (row.primaryKey !== record.chatId) { store.delete(row.primaryKey); extra--; }
                        row.continue();
                    };
                };
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
                tx.onabort = () => resolve(false);
            } catch (e) {
                resolve(false);
            }
        });
    }

    async function rsCacheDelete(chatId) {
        const db = await rsDb();
        if (!db) return;
        await new Promise(resolve => {
            try {
                const tx = db.transaction(RS_STORE, 'readwrite');
                tx.objectStore(RS_STORE).delete(chatId);
                tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
            } catch (e) {
                resolve();
            }
        });
    }

    // 북마크: 방마다 한 줄 { chatId, items }
    async function rsBmRead(chatId) {
        const db = await rsDb();
        if (!db) return [];
        return new Promise(resolve => {
            try {
                const request = db.transaction(RS_BM_STORE, 'readonly').objectStore(RS_BM_STORE).get(chatId);
                request.onsuccess = () => resolve(Array.isArray(request.result?.items) ? request.result.items.filter(b => b && RS_ID.test(String(b.messageId || ''))) : []);
                request.onerror = () => resolve([]);
            } catch (e) {
                resolve([]);
            }
        });
    }

    async function rsBmWrite(chatId, items) {
        const db = await rsDb();
        if (!db) return false;
        return new Promise(resolve => {
            try {
                const tx = db.transaction(RS_BM_STORE, 'readwrite');
                tx.objectStore(RS_BM_STORE).put({ chatId, items, savedAt: Date.now() });
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
                tx.onabort = () => resolve(false);
            } catch (e) {
                resolve(false);
            }
        });
    }

    // ---------- 크랙 API (읽기 전용) ----------
    function rsAuthHeaders() {
        const captured = getAuthHeaderOnly();
        if (captured.authorization) return captured;
        try {
            const match = /(?:^|;\s*)access_token=([^;]+)/.exec(document.cookie);
            if (match) return { authorization: `Bearer ${decodeURIComponent(match[1])}` };
        } catch (e) {}
        return {};
    }

    async function rsApi(url, signal) {
        for (let attempt = 0; ; attempt++) {
            let response;
            try {
                response = await fetch(url, { headers: { accept: 'application/json, text/plain, */*', platform: 'web', 'wrtn-locale': 'ko-KR', ...rsAuthHeaders() }, signal });
            } catch (error) {
                if (signal?.aborted || attempt >= 3) throw error;
                await rsWait(800 * 2 ** attempt, signal);
                continue;
            }
            if (response.ok) {
                const body = await response.json();
                return body && typeof body === 'object' && 'data' in body ? body.data : body;
            }
            if (response.status === 401 && attempt < 1) {
                await waitForAuthToken(3000);
                continue;
            }
            if ((response.status === 429 || response.status >= 500) && attempt < 4) {
                const after = Number(response.headers.get('retry-after'));
                await rsWait(after > 0 ? Math.min(after, 20) * 1000 : Math.min(12000, 1000 * 2 ** attempt), signal);
                continue;
            }
            const error = new Error(response.status === 401 ? '로그인이 풀렸어요. 새로고침한 뒤 다시 열어 주세요.' : `크랙 서버가 요청을 거절했어요 (${response.status})`);
            error.status = response.status;
            throw error;
        }
    }

    // 최신 페이지부터 받는다. onPage가 false를 돌려주면 멈춘다.
    async function rsFetchPages(chatId, onPage, signal) {
        const cursors = new Set();
        let cursor = '';
        let step = 0;
        let pages = 0;
        for (;;) {
            let data;
            try {
                data = await rsApi(`${RS_API}${chatId}/messages?limit=${RS_PAGE_LIMITS[step]}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, signal);
            } catch (error) {
                // 큰 페이지를 거절하면 더 작게 다시 받는다(바쁠 때는 아님).
                if (!pages && step < RS_PAGE_LIMITS.length - 1 && [400, 413, 422].includes(error.status)) { step++; continue; }
                throw error;
            }
            const list = Array.isArray(data?.messages) ? data.messages : [];
            pages++;
            const next = data?.nextCursor ? String(data.nextCursor) : '';
            const end = !data?.hasNext || !next || !list.length || cursors.has(next);
            if (onPage(list, end) === false || end) return;
            cursors.add(next);
            cursor = next;
            await rsWait(RS_PAGE_GAP_MS, signal);
        }
    }

    function rsSlim(m) {
        return {
            _id: String(m?._id || ''),
            role: m?.role === 'user' ? 'user' : 'assistant',
            turnId: String(m?.turnId || ''),
            parentTurnId: String(m?.parentTurnId || ''),
            content: typeof m?.content === 'string' ? m.content : String(m?.content ?? '')
        };
    }

    // 다른 확프가 메시지 안에 숨겨 둔 블록과 이미지·주석 줄은 검색에서 뺀다.
    function rsClean(input) {
        let text = String(input || '').replace(/\r\n?/g, '\n');
        for (let pass = 0; pass < 4; pass++) {
            const before = text;
            text = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<(rp_context_manager|ooc_lore_context)\b[\s\S]*?<\/\1\s*>/gi, '');
            if (text === before) break;
        }
        const lines = [];
        for (const line of text.split('\n')) {
            if (/^\s*\[(?:\/\/|comment)\]:\s*#/i.test(line)) continue;
            if (/^\s*```/.test(line)) continue;
            if (/^\s*https?:\/\/\S+\.(?:png|jpe?g|webp|gif|avif)(?:\?\S*)?\s*$/i.test(line)) continue;
            lines.push(line.indexOf('![') >= 0 ? line.replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, '') : line);
        }
        return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    function rsNorm(text) {
        return /[A-Z]/.test(text) ? text.toLowerCase() : text;
    }

    // raw는 최신 순. parentTurnId를 따라가면 실제로 이어진 대화 줄기이고, 줄기 밖의 AI 답변은 리롤이다.
    function rsBuild(raw, complete) {
        let chain = raw;
        if (raw.some(m => m.turnId)) {
            const byTurn = new Map();
            for (const m of raw) if (m.turnId && !byTurn.has(m.turnId)) byTurn.set(m.turnId, m);
            chain = [];
            const seen = new Set();
            let cur = raw[0] || null;
            while (cur) {
                const key = cur.turnId || cur._id;
                if (seen.has(key)) break;
                seen.add(key);
                chain.push(cur);
                cur = cur.parentTurnId ? byTurn.get(cur.parentTurnId) : null;
            }
        }
        const list = chain.slice().reverse();
        let users = 0;
        for (const m of list) if (m.role === 'user') users++;
        const messages = [];
        let turn = 0;
        for (const m of list) {
            if (m.role === 'user') turn++;
            const text = rsClean(m.content);
            if (!text) continue;
            messages.push({ id: m._id, role: m.role, turnId: m.turnId, parentTurnId: m.parentTurnId, turn, back: users - turn, text, norm: rsNorm(text), tnum: rsTurnNumber(text) });
        }
        // 본문에 [T123] 같은 턴 표시가 있으면 그 번호를 쓴다. 사용자 메시지는 바로 이어지는 답변의 번호를 따른다.
        for (let i = 0; i < messages.length - 1; i++) {
            if (messages[i].role === 'user' && messages[i].tnum === null && messages[i + 1].role !== 'user') messages[i].tnum = messages[i + 1].tnum;
        }
        return { messages, lastTurn: turn, rooted: !!(complete && list.length && !list[0].parentTurnId) };
    }

    function rsTurnNumber(text) {
        const lines = String(text || '').split(/\n+/).map(line => line.trim()).filter(Boolean).slice(0, 20);
        for (const line of lines) {
            const match = RS_TURN_LINE.exec(line);
            if (match) return Number(match[1]);
        }
        return null;
    }

    function rsApplyRaw(raw, complete) {
        rs.raw = raw;
        rs.byId = new Map();
        rs.byTurn = new Map();
        rs.replies = new Map();
        for (const m of raw) {
            rs.byId.set(m._id, m);
            if (m.turnId && !rs.byTurn.has(m.turnId)) rs.byTurn.set(m.turnId, m);
            if (m.role !== 'user' && m.parentTurnId) {
                if (!rs.replies.has(m.parentTurnId)) rs.replies.set(m.parentTurnId, []);
                rs.replies.get(m.parentTurnId).push(m);
            }
        }
        rs.domOnly = false;
        const built = rsBuild(raw, complete);
        rs.messages = built.messages;
        rs.msgById = new Map(built.messages.map(m => [m.id, m]));
        rs.lastTurn = built.lastTurn;
        rs.rooted = built.rooted;
        rsRunSearch();
        if (complete) rsBmEnrich();
    }

    // ---------- 받기 ----------
    function rsStopLoad(silent = false) {
        rs.abort?.abort();
        rs.abort = null;
        rs.loading = false;
        rs.refreshing = false;
        if (!silent) rsRenderAll();
    }

    async function rsLoad({ force = false } = {}) {
        const chatId = rs.chatId;
        if (!chatId) return;
        if ((rs.loading || rs.refreshing) && !force) return;
        rsStopLoad(true);
        const token = ++rs.loadToken;
        const controller = new AbortController();
        rs.abort = controller;
        rs.error = '';
        const alive = () => token === rs.loadToken && rs.chatId === chatId;

        if (force) await rsCacheDelete(chatId);
        const cached = force ? null : await rsCacheGet(chatId);
        if (!alive()) return;

        if (cached?.complete && Array.isArray(cached.raw)) {
            rs.complete = true;
            rs.loadedCount = cached.raw.length;
            rs.refreshing = true;
            rsApplyRaw(cached.raw, true);
            rsRenderStatus();
            try {
                const merged = await rsRefreshRaw(chatId, cached.raw, controller.signal);
                if (!alive()) return;
                rs.loadedCount = merged.length;
                rsApplyRaw(merged, true);
                rsCachePut({ chatId, raw: merged, complete: true, savedAt: Date.now() });
            } catch (error) {
                if (alive() && !controller.signal.aborted) showTunerToast('최근 대화를 다시 받지 못해서 저장해 둔 로그로 찾고 있어요');
            } finally {
                if (alive()) {
                    rs.refreshing = false;
                    if (rs.abort === controller) rs.abort = null;
                    rsRenderAll();
                }
            }
            return;
        }

        rs.loading = true;
        rs.complete = false;
        rs.loadedCount = 0;
        const raw = [];
        const ids = new Set();
        rsRenderAll();
        try {
            await rsFetchPages(chatId, (list, end) => {
                if (!alive()) return false;
                for (const m of list) {
                    const slim = rsSlim(m);
                    if (slim._id && !ids.has(slim._id)) { ids.add(slim._id); raw.push(slim); }
                }
                rs.loadedCount = raw.length;
                rsApplyRaw(raw, end);
                rsRenderStatus();
            }, controller.signal);
            if (!alive()) return;
            rs.complete = true;
            rsApplyRaw(raw, true);
            const saved = await rsCachePut({ chatId, raw, complete: true, savedAt: Date.now() });
            if (!saved) console.warn('[Crack UI] 이 방 로그를 브라우저 DB에 보관하지 못했습니다.');
        } catch (error) {
            if (!alive() || controller.signal.aborted) return;
            rs.error = error?.message || String(error);
            // 서버에서 못 받으면 화면에 불러온 대화에서라도 찾는다.
            if (!rs.messages.length) rsUseDomFallback();
        } finally {
            if (alive()) {
                rs.loading = false;
                if (rs.abort === controller) rs.abort = null;
                rsRenderAll();
            }
        }
    }

    // 최근 페이지만 다시 받아 그 범위를 새것으로 바꾼다. 그 사이 고치거나 지운 메시지도 맞춰진다.
    async function rsRefreshRaw(chatId, cachedRaw, signal) {
        const position = new Map(cachedRaw.map((m, i) => [m._id, i]));
        const fresh = [];
        const ids = new Set();
        let merged = null;
        await rsFetchPages(chatId, (list, end) => {
            for (const m of list) {
                const slim = rsSlim(m);
                if (slim._id && !ids.has(slim._id)) { ids.add(slim._id); fresh.push(slim); }
            }
            const oldest = fresh[fresh.length - 1];
            const at = oldest ? position.get(oldest._id) : undefined;
            if (at !== undefined) {
                merged = fresh.concat(cachedRaw.slice(at + 1));
                return false;
            }
            if (end) merged = fresh;
            return true;
        }, signal);
        return merged || cachedRaw;
    }

    // ---------- 찾기 ----------
    function rsRunSearch({ keepCurrent = true } = {}) {
        const q = rs.query.trim().toLowerCase();
        const prevId = keepCurrent ? rs.results[rs.index]?.m.id : '';
        if (!q) {
            rs.results = [];
            rs.index = -1;
        } else {
            const hits = [];
            for (const m of rs.messages) {
                if (rs.filter !== 'all' && m.role !== rs.filter) continue;
                const at = m.norm.indexOf(q);
                if (at >= 0) hits.push({ m, at, count: rsCount(m.norm, q) });
            }
            if (rs.sort === 'new') hits.reverse();
            rs.results = hits;
            const keep = prevId ? hits.findIndex(hit => hit.m.id === prevId) : -1;
            rs.index = keep >= 0 ? keep : (hits.length ? 0 : -1);
            if (rs.index >= rs.shown) rs.shown = rs.index + 1;
        }
        if (rs.expandedId && !rs.results.some(hit => hit.m.id === rs.expandedId)) rs.expandedId = '';
        rsRenderCounts();
        rsRenderList();
        rsRenderStatus();
        rsScheduleHighlights();
    }

    function rsCount(hay, q) {
        let count = 0;
        for (let from = hay.indexOf(q); from >= 0; from = hay.indexOf(q, from + q.length)) count++;
        return count;
    }

    function rsTurnLabel(m) {
        if (Number.isFinite(m.tnum)) return `T${m.tnum}`;
        if (m.dom) return '화면 속';
        if (rs.rooted) return m.turn === 0 ? '프롤로그' : `${m.turn}턴`;
        return m.back === 0 ? '최근 턴' : `${m.back}턴 전`;
    }

    // 텍스트에 검색어를 표시한다(innerHTML을 쓰지 않는다).
    function rsMarked(text, q) {
        const frag = document.createDocumentFragment();
        if (!q) { frag.append(text); return frag; }
        const hay = text.toLowerCase();
        let from = 0;
        let at;
        while ((at = hay.indexOf(q, from)) >= 0) {
            if (at > from) frag.append(text.slice(from, at));
            frag.append(ctEl('mark', '', text.slice(at, at + q.length)));
            from = at + q.length;
        }
        if (from < text.length) frag.append(text.slice(from));
        return frag;
    }

    function rsSnippet(text, at, q) {
        const start = Math.max(0, at - 36);
        const end = Math.min(text.length, at + q.length + 90);
        const piece = (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : '');
        const span = ctEl('span', 'crs-snippet');
        span.append(rsMarked(piece, q));
        return span;
    }

    function rsFindGroup(id) {
        if (!id) return null;
        try { return document.querySelector(`div[data-message-group-id="${CSS.escape(id)}"]`); } catch (e) { return null; }
    }

    function rsItem(hit, index, q) {
        const m = hit.m;
        const open = rs.expandedId === m.id;
        const item = ctEl('div', `crs-item${index === rs.index ? ' is-current' : ''}${open ? ' is-open' : ''}`);
        item.dataset.id = m.id;
        item.dataset.i = String(index);
        item.setAttribute('role', 'listitem');
        const head = ctEl('button', 'crs-item-head');
        head.type = 'button';
        head.dataset.act = 'toggle';
        head.setAttribute('aria-expanded', String(open));
        const meta = ctEl('span', 'crs-item-meta');
        meta.append(ctEl('span', 'crs-chip', rsTurnLabel(m)), ctEl('span', 'crs-who', `${m.role === 'user' ? '나' : m.role ? '캐릭터' : '메시지'}${hit.count > 1 ? ` · 이 메시지 안 ${hit.count}곳` : ''}`));
        if (rs.bm.chatId === rs.chatId && rs.bm.ids.has(m.id)) {
            const mark = ctEl('span', 'crs-meta-star');
            mark.innerHTML = rsStar(13, true);
            mark.title = '북마크한 메시지';
            meta.append(mark);
        }
        if (open) {
            const chevron = ctEl('span', 'crs-chev');
            chevron.innerHTML = RS_ICON.up;
            meta.append(chevron);
        }
        head.append(meta);
        if (!open) head.append(rsSnippet(m.text, hit.at, q));
        item.append(head);
        if (open) {
            const body = ctEl('div', 'crs-body');
            for (const paragraph of m.text.split(/\n+/)) {
                if (!paragraph.trim()) continue;
                const p = ctEl('p');
                p.append(rsMarked(paragraph, q));
                body.append(p);
            }
            const actions = ctEl('div', 'crs-actions');
            const go = ctEl('button', 'crs-goto', '대화에서 보기');
            go.type = 'button';
            go.dataset.act = 'goto';
            const onScreen = !!rsFindGroup(m.id);
            const occ = onScreen && rs.occ && rs.occ.id === m.id && rs.occ.ranges.length > 1 ? rs.occ : null;
            const hint = onScreen
                ? (occ ? `화면에서 ${occ.index + 1}/${occ.ranges.length}번째 · ↑↓는 이 안을 먼저 돌아요` : '화면에 있어요')
                : m.back > 0 && !m.dom ? `${m.back.toLocaleString()}턴 위 · 불러오면서 이동해요` : '불러오면서 이동해요';
            const notice = rsNoticeEl(m.id);
            if (notice) body.append(notice);
            actions.append(go, ctEl('span', 'crs-goto-hint', hint));
            body.append(actions);
            item.append(body);
        }
        return item;
    }

    // ---------- 그리기 ----------
    function rsEnsureRoot() {
        if (rs.root?.isConnected) return rs.root;
        const root = ctEl('section', 'crs');
        root.id = 'crack-room-search';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-label', '이 방에서 찾기');
        root.innerHTML = `
            <div class="crs-head">
                <strong class="crs-title">이 방에서 찾기</strong>
                <button type="button" class="crs-icon crs-refresh" data-act="refresh" aria-label="로그 다시 받기" title="로그 처음부터 다시 받기">${RS_ICON.refresh}</button>
                <button type="button" class="crs-icon crs-close" data-act="close" aria-label="닫기" title="닫기 (Esc)">${CT_ICON.x}</button>
            </div>
            <div class="crs-tabs" role="tablist" aria-label="찾기 · 북마크 · 형광펜"><i aria-hidden="true"></i>
                <button type="button" role="tab" data-tab="search" aria-selected="true">${CT_ICON.search}<span>검색</span></button>
                <button type="button" role="tab" data-tab="bm" aria-selected="false">${rsStar(14, false)}<span>북마크</span><span class="crs-tab-count"></span></button>
                <button type="button" role="tab" data-tab="hl" aria-selected="false">${HP_IC.hl}<span>형광펜</span><span class="crs-tab-count crs-hl-count"></span></button>
            </div>
            <div class="crs-bar" role="search">
                ${CT_ICON.search}
                <input type="search" class="crs-input" placeholder="이 방 본문 검색" aria-label="이 방 본문 검색" autocomplete="off" spellcheck="false">
                <span class="crs-count" aria-live="polite">0 / 0</span>
                <i class="crs-sep" aria-hidden="true"></i>
                <button type="button" class="crs-icon" data-act="prev" aria-label="이전 결과" title="이전 결과 (Shift+Enter)">${RS_ICON.up}</button>
                <button type="button" class="crs-icon" data-act="next" aria-label="다음 결과" title="다음 결과 (Enter)">${RS_ICON.down}</button>
            </div>
            <div class="crs-tools">
                <div class="crs-chips" role="group" aria-label="누구의 말">
                    <button type="button" data-filter="all">전체</button><button type="button" data-filter="assistant">캐릭터</button><button type="button" data-filter="user">나</button>
                </div>
                <button type="button" class="crs-sort" data-act="sort">${RS_ICON.sort}<span class="crs-sort-text">최신 순</span></button>
            </div>
            <div class="crs-status" aria-live="polite"></div>
            <div class="crs-list" role="list" aria-label="찾은 메시지"></div>
            <div class="crs-bm-tools"><span class="crs-bm-count"></span><select class="crs-bm-sort" aria-label="북마크 정렬"><option value="recent">최근 저장순</option><option value="chat">대화 순서</option></select></div>
            <div class="crs-bm-list" role="list" aria-label="북마크"></div>
            <div class="crs-hl"></div>
            <div class="crs-foot"><button type="button" class="crs-other" data-act="other">${CT_ICON.search}<span class="crs-other-text">다른 채팅방에서 찾기</span>${RS_ICON.out}</button></div>
            <button type="button" class="crs-listtoggle" data-act="list" aria-expanded="false">${RS_ICON.up}<span class="crs-lt-label">목록 보기</span><span class="crs-lt-meta"></span></button>
        `;
        root.addEventListener('click', rsOnClick);
        root.addEventListener('input', rsOnInput);
        root.addEventListener('change', rsOnChange);
        root.addEventListener('keydown', rsOnKeydown);
        // 크랙 단축키(react-hotkeys-hook)가 이 창의 키를 받지 않게 한다.
        root.addEventListener('keyup', event => event.stopPropagation());
        document.body.appendChild(root);
        let backdrop = document.getElementById('crack-room-search-backdrop');
        if (!backdrop) {
            backdrop = ctEl('div');
            backdrop.id = 'crack-room-search-backdrop';
            backdrop.addEventListener('click', () => rsSetListOpen(false));
            document.body.appendChild(backdrop);
        }
        rs.root = root;
        return root;
    }

    function rsRenderAll() {
        if (!rs.root) return;
        rsRenderCounts();
        rs.root.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === rs.filter)));
        rs.root.querySelector('.crs-sort-text').textContent = rs.sort === 'old' ? '오래된 순' : '최신 순';
        rs.root.querySelector('.crs-refresh').classList.toggle('is-busy', rs.loading || rs.refreshing);
        rsRenderStatus();
        rsRenderList();
        rsRenderTabs();
        rsRenderBm();
        rsPosition();
    }

    function rsRenderCounts() {
        if (!rs.root) return;
        const total = rs.results.length;
        rs.root.querySelector('.crs-count').textContent = total ? `${(rs.index + 1).toLocaleString()} / ${total.toLocaleString()}` : '0 / 0';
        rs.root.querySelectorAll('[data-act="prev"], [data-act="next"]').forEach(button => { button.disabled = !total; });
        const other = rs.root.querySelector('.crs-other-text');
        const q = rs.query.trim();
        other.textContent = q ? `다른 채팅방에서 ‘${q}’ 찾기` : '다른 채팅방에서 찾기';
    }

    function rsStatusText() {
        const q = rs.query.trim();
        if (rs.error) return rs.domOnly ? `로그를 받지 못해 화면에 불러온 대화에서만 찾았어요${q ? ` · ${rs.results.length.toLocaleString()}곳` : ''}` : rs.error;
        if (rs.loading) return `로그 받는 중 · ${rs.loadedCount.toLocaleString()}개${q ? ` · 지금까지 ${rs.results.length.toLocaleString()}곳` : ''}`;
        if (!rs.complete) return rs.loadedCount ? `일부만 받았어요 · ${rs.loadedCount.toLocaleString()}개${q ? ` · ${rs.results.length.toLocaleString()}곳` : ''}` : '';
        const turns = rs.rooted ? `전체 ${rs.lastTurn.toLocaleString()}턴` : `최근 ${rs.lastTurn.toLocaleString()}턴`;
        if (!q) return `${turns} · 찾을 말을 입력하세요`;
        if (!rs.results.length) return `${turns}에서 찾지 못했어요`;
        return `${turns}에서 ${rs.results.length.toLocaleString()}곳 · 누르면 여기서 바로 펼쳐져요`;
    }

    function rsRenderStatus() {
        if (!rs.root) return;
        const box = rs.root.querySelector('.crs-status');
        const row = ctEl('div', 'crs-status-row');
        const label = ctEl('span', '', rs.jump ? `대화 불러오는 중 · 화면에 ${(rs.jump.loaded || 0).toLocaleString()}개` : rsStatusText());
        row.append(label);
        const button = (text, act) => { const b = ctEl('button', '', text); b.type = 'button'; b.dataset.act = act; return b; };
        if (rs.jump) row.append(button('중지', 'jumpstop'));
        else if (rs.loading) row.append(button('중지', 'stop'));
        else if (rs.error || (!rs.complete && rs.loadedCount)) row.append(button(rs.error ? '다시 시도' : '이어 받기', 'retry'));
        else if (rs.refreshing) row.append(ctEl('em', 'crs-quiet', '최근 대화 확인 중'));
        const parts = [row];
        if (rs.loading || rs.jump) {
            const bar = ctEl('div', 'crs-progress');
            bar.append(ctEl('i'));
            parts.push(bar);
        }
        box.classList.toggle('is-error', !!rs.error);
        box.classList.toggle('is-jump', !!rs.jump);
        box.replaceChildren(...parts);
        rs.root.querySelector('.crs-refresh').classList.toggle('is-busy', rs.loading || rs.refreshing);
        // 모바일 카드의 「목록 보기」 줄
        const meta = rs.root.querySelector('.crs-lt-meta');
        const q = rs.query.trim();
        meta.textContent = rs.jump ? '불러오는 중 · 눌러서 중지'
            : rs.tab === 'bm' ? `북마크 ${rs.bm.chatId === rs.chatId ? rs.bm.items.length : 0}개`
            : rs.loading ? `받는 중 ${rs.loadedCount.toLocaleString()}개`
            : rs.error ? '받지 못했어요'
            : `${rs.rooted ? '전체' : '최근'} ${rs.lastTurn.toLocaleString()}턴${q ? ` · ${rs.results.length.toLocaleString()}곳` : ''}`;
        const toggle = rs.root.querySelector('.crs-listtoggle');
        toggle.setAttribute('aria-expanded', String(rs.listOpen));
        toggle.querySelector('.crs-lt-label').textContent = rs.listOpen ? '목록 접기' : '목록 보기';
    }

    function rsRenderList() {
        if (!rs.root) return;
        const list = rs.root.querySelector('.crs-list');
        const q = rs.query.trim().toLowerCase();
        const frag = document.createDocumentFragment();
        if (!q) {
            frag.append(ctEl('div', 'crs-empty', '찾을 말을 위에 입력하세요'));
        } else if (!rs.results.length) {
            if (!rs.loading) frag.append(ctEl('div', 'crs-empty', `‘${rs.query.trim()}’이(가) 들어간 메시지가 없어요`));
        } else {
            const count = Math.min(rs.results.length, Math.max(rs.shown, rs.index + 1));
            for (let i = 0; i < count; i++) frag.append(rsItem(rs.results[i], i, q));
            if (count < rs.results.length) {
                const more = ctEl('button', 'crs-more', `${(rs.results.length - count).toLocaleString()}개 더 보기`);
                more.type = 'button';
                more.dataset.act = 'more';
                frag.append(more);
            }
        }
        list.replaceChildren(frag);
        rsObserveMore(list);
    }

    // 목록 끝에 닿으면 다음 결과를 저절로 붙인다(버튼은 키보드용으로 남긴다).
    function rsObserveMore(list) {
        rs.moreObserver?.disconnect();
        const more = list.querySelector('.crs-more');
        if (!more || typeof IntersectionObserver === 'undefined') return;
        rs.moreObserver = new IntersectionObserver(entries => {
            if (!entries.some(entry => entry.isIntersecting)) return;
            rs.moreObserver.disconnect();
            rs.shown += RS_RESULT_STEP;
            rsRenderList();
        }, { root: list, rootMargin: '240px' });
        rs.moreObserver.observe(more);
    }

    function rsScrollCurrentIntoView() {
        const item = rs.root?.querySelector('.crs-item.is-current');
        if (!item) return;
        const list = rs.root.querySelector('.crs-list');
        const top = item.offsetTop - list.offsetTop;
        if (top < list.scrollTop || top + Math.min(item.offsetHeight, list.clientHeight) > list.scrollTop + list.clientHeight) {
            list.scrollTop = Math.max(0, top - 8);
        }
    }

    function rsSchedulePosition() {
        if (!rs.open || rs.positionFrame) return;
        rs.positionFrame = requestAnimationFrame(() => { rs.positionFrame = 0; rsPosition(); });
    }

    function rsPosition() {
        const root = rs.root;
        if (!root) return;
        const mobile = isMobileLounge();
        root.classList.toggle('is-mobile', mobile);
        root.classList.toggle('is-list', mobile && rs.listOpen);
        document.getElementById('crack-room-search-backdrop')?.classList.toggle('is-on', rs.open && mobile && rs.listOpen);
        if (!mobile) {
            root.style.removeProperty('top');
            root.style.removeProperty('bottom');
            rsApplyPush(rs.open);
            return;
        }
        rsApplyPush(false);
        const viewport = window.visualViewport;
        const viewTop = viewport ? viewport.offsetTop : 0;
        const viewBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
        const composer = rsFindComposerContainer(rsFindComposerEditable());
        let anchor = composer ? composer.getBoundingClientRect().top : viewBottom - 96;
        anchor = Math.min(anchor, viewBottom - 8);
        root.style.bottom = `${Math.max(8, Math.round(window.innerHeight - anchor + 8))}px`;
        root.style.top = rs.listOpen ? `${Math.round(viewTop + 56)}px` : 'auto';
    }

    function rsCommonAncestor(a, b) {
        const chain = new Set();
        for (let el = a; el; el = el.parentElement) chain.add(el);
        for (let el = b; el; el = el.parentElement) if (chain.has(el)) return el;
        return null;
    }

    // PC 패널이 열려 있는 동안 채팅 칸(대화 + 입력창)을 패널 너비만큼 왼쪽으로 민다. 크랙 요소에는 표시 속성만 붙였다 뗀다.
    function rsApplyPush(on) {
        const previous = document.querySelector('[data-crs-push]');
        let target = null;
        if (on && rs.root) {
            const scroller = rsScrollContainer();
            if (scroller && scroller !== document.scrollingElement && scroller !== document.documentElement && scroller !== document.body) {
                const composer = rsFindComposerContainer(rsFindComposerEditable());
                target = composer ? rsCommonAncestor(scroller, composer) : scroller;
                if (!target || target === document.body || target === document.documentElement) target = scroller;
            }
        }
        if (previous && previous !== target) {
            previous.removeAttribute('data-crs-push');
            previous.style.removeProperty('--crs-push');
            previous.style.removeProperty('--crs-pad0');
        }
        if (!target) return;
        const panelLeft = rs.root.getBoundingClientRect().left;
        const rect = target.getBoundingClientRect();
        const base = target.hasAttribute('data-crs-push') ? Number.parseFloat(target.style.getPropertyValue('--crs-pad0')) || 0 : Number.parseFloat(getComputedStyle(target).paddingRight) || 0;
        const overlap = Math.round(rect.right - panelLeft);
        if (overlap <= 0 || rect.width - overlap < 480) {
            target.removeAttribute('data-crs-push');
            target.style.removeProperty('--crs-push');
            target.style.removeProperty('--crs-pad0');
            return;
        }
        target.style.setProperty('--crs-pad0', `${base}px`);
        target.style.setProperty('--crs-push', `${overlap}px`);
        target.setAttribute('data-crs-push', '');
    }

    // ---------- 열기 · 닫기 ----------
    function rsOpen({ focus = true } = {}) {
        const chatId = rsChatIdFromPath();
        if (!chatId) return;
        rsEnsureRoot();
        if (rs.chatId !== chatId) {
            rs.chatId = chatId;
            rs.messages = [];
            rs.results = [];
            rs.index = -1;
            rs.expandedId = '';
            rs.complete = false;
            rs.rooted = false;
            rs.lastTurn = 0;
            rs.loadedCount = 0;
            rs.error = '';
            rs.shown = RS_RESULT_STEP;
            rs.raw = [];
            rs.byId = new Map();
            rs.byTurn = new Map();
            rs.replies = new Map();
            rs.msgById = new Map();
            rs.notices.clear();
            rs.occ = null;
            rs.domOnly = false;
            rs.tab = isMobileLounge() ? 'search' : hpLastTab();
            rs.bmOpenId = '';
            rs.bmEditId = '';
        }
        rsBmEnsure(chatId);
        rs.open = true;
        rs.listOpen = false;
        rs.root.classList.add('is-open');
        rs.launcher?.setAttribute('aria-pressed', 'true');
        const input = rs.root.querySelector('.crs-input');
        if (input.value !== rs.query) input.value = rs.query;
        rsRenderAll();
        rsStartHighlightWatch();
        if (focus) requestAnimationFrame(() => { input.focus({ preventScroll: true }); input.select(); });
        rsLoad();
    }

    function rsClose() {
        if (!rs.open) return;
        rs.open = false;
        rs.listOpen = false;
        rsStopJump();
        rsStopLoad(true);
        const hadFocus = rs.root?.contains(document.activeElement);
        rs.root?.classList.remove('is-open', 'is-list');
        document.getElementById('crack-room-search-backdrop')?.classList.remove('is-on');
        rs.launcher?.setAttribute('aria-pressed', 'false');
        rsStopHighlightWatch();
        rsClearHighlights();
        rsApplyPush(false);
        rs.occ = null;
        rs.bmEditId = '';
        if (hadFocus && rs.launcher?.isConnected) rs.launcher.focus({ preventScroll: true });
    }

    function rsSetListOpen(open) {
        if (rs.listOpen === !!open) return;
        rs.listOpen = !!open;
        // 모바일 카드를 접으면 검색줄로 돌아간다.
        if (!rs.listOpen && (rs.tab === 'bm' || rs.tab === 'hl') && rs.root?.classList.contains('is-mobile')) {
            rs.tab = 'search';
            rs.bmEditId = '';
            rsRenderTabs();
        }
        rsRenderStatus();
        rsPosition();
        if (rs.listOpen) requestAnimationFrame(rsScrollCurrentIntoView);
    }

    // ---------- 고르기 · 이동 ----------
    function rsStep(dir) {
        const total = rs.results.length;
        if (!total) return;
        // 지금 결과가 화면에 있고 그 안에 검색어가 여러 번 있으면 그 안을 먼저 한 군데씩 돈다.
        const current = rs.results[rs.index];
        if (dir && current && rs.occ && rs.occ.id === current.m.id && rsRefreshOcc()) {
            const next = rs.occ.index + dir;
            if (next >= 0 && next < rs.occ.ranges.length) {
                rs.occ.index = next;
                rsShowOcc();
                rsRenderList();
                return;
            }
        }
        rs.index = ((rs.index < 0 ? (dir > 0 ? -1 : 0) : rs.index) + dir + total) % total;
        const hit = rs.results[rs.index];
        rs.expandedId = hit.m.id;
        if (rs.index >= rs.shown) rs.shown = rs.index + 1;
        rsRenderCounts();
        rsRenderList();
        requestAnimationFrame(rsScrollCurrentIntoView);
        rsScheduleHighlights();
        const listHidden = rs.root.classList.contains('is-mobile') && !rs.listOpen;
        rsGoto(hit.m.id, { noLoad: !listHidden, landing: dir < 0 ? 'last' : 'first' });
    }

    function rsToggleItem(id, index) {
        rs.index = Number.isFinite(index) ? index : rs.index;
        rs.expandedId = rs.expandedId === id ? '' : id;
        rsRenderCounts();
        rsRenderList();
        rsScheduleHighlights();
        if (rs.expandedId) rsGoto(id, { noLoad: true });
    }

    function rsFocusGroup(group, { landing = 'first', flash = true } = {}) {
        const id = group.getAttribute('data-message-group-id') || '';
        const ranges = rsRangesIn(group, rs.query.trim().toLowerCase());
        rs.occ = { id, ranges, index: ranges.length ? (landing === 'last' ? ranges.length - 1 : 0) : -1 };
        rsShowOcc(group);
        if (flash) rsFlash(group);
        rsRenderList();
    }

    function rsStopJump() {
        if (!rs.jump) return;
        rs.jump.stopped = true;
        rs.jump = null;
        rsRenderStatus();
    }

    function rsGroupCount() {
        return document.querySelectorAll('div[data-message-group-id]').length;
    }

    function rsWaitForMore(before, id, timeout) {
        return new Promise(resolve => {
            let done = false;
            let frame = 0;
            const finish = value => {
                if (done) return;
                done = true;
                observer.disconnect();
                clearTimeout(timer);
                cancelAnimationFrame(frame);
                resolve(value);
            };
            const observer = new MutationObserver(() => {
                if (frame) return;
                frame = requestAnimationFrame(() => {
                    frame = 0;
                    if (rsFindGroup(id) || rsGroupCount() > before) setTimeout(() => finish(true), 150);
                });
            });
            observer.observe(document.body, { childList: true, subtree: true });
            const timer = setTimeout(() => finish(rsGroupCount() > before), timeout);
        });
    }

    function rsOldestLoadedId() {
        let oldest = '';
        for (const group of document.querySelectorAll('div[data-message-group-id]')) {
            const id = group.getAttribute('data-message-group-id') || '';
            if (RS_ID.test(id) && (!oldest || id < oldest)) oldest = id;
        }
        return oldest;
    }

    // 화면에 없으면 크랙이 예전 대화를 그리도록 맨 위로 스크롤하기를 되풀이한다. 새로 그려지는 즉시 다음으로 넘어간다.
    // 1.6.0: 목표보다 오래된 메시지가 이미 보이거나 첫 메시지까지 왔으면 지워졌거나 리롤로 바뀐 것으로 보고 멈춘다.
    async function rsGoto(id, { noLoad = false, landing = 'first' } = {}) {
        let group = rsFindGroup(id);
        if (group) {
            rs.notices.delete(id);
            rsFocusGroup(group, { landing });
            return true;
        }
        if (noLoad) return false;
        rsStopJump();
        if (rs.root?.classList.contains('is-mobile')) rsSetListOpen(false);
        const job = { id, stopped: false, loaded: rsGroupCount() };
        rs.jump = job;
        rsRenderStatus();
        let idle = 0;
        let missing = '';
        for (let round = 0; round < 1500 && !job.stopped && rs.open; round++) {
            group = rsFindGroup(id);
            if (group) break;
            const oldest = rsOldestLoadedId();
            // ObjectId는 시간 순서라서, 목표보다 오래된 메시지가 이미 보이는데 목표가 없으면 지워졌거나 바뀐 것이다.
            if (oldest && RS_ID.test(id) && oldest < id) { missing = 'passed'; break; }
            const first = rs.complete && rs.raw.length ? rs.raw[rs.raw.length - 1]._id : '';
            if (first && oldest === first) { missing = 'top'; break; }
            // 탭이 뒤에 있으면 크랙이 그리지 않으므로 보일 때까지 기다린다.
            while (document.hidden && !job.stopped) await rsWait(400);
            if (job.stopped) break;
            const before = rsGroupCount();
            const scroller = rsScrollContainer();
            rsSetScrollTop(scroller, 0);
            const grew = await rsWaitForMore(before, id, 2600);
            if (job.stopped) break;
            if (grew) {
                idle = 0;
            } else {
                idle++;
                if (idle >= 4) { missing = 'stalled'; break; }
                // 이미 맨 위면 크랙의 불러오기가 다시 걸리도록 살짝 내렸다 올린다.
                rsSetScrollTop(scroller, Math.min(240, scroller.scrollHeight || 240));
                await rsWait(80);
            }
            job.loaded = rsGroupCount();
            if (rs.jump === job) rsRenderStatus();
        }
        if (rs.jump === job) rs.jump = null;
        if (rs.open) rsRenderStatus();
        if (job.stopped) return false;
        group = group || rsFindGroup(id);
        if (group) {
            rs.notices.delete(id);
            rsFocusGroup(group, { landing });
            return true;
        }
        rsNoteMissing(id, missing || 'stalled');
        return false;
    }

    // 찾지 못한 이유를 결과·북마크에 붙인다. 같은 질문의 다른 리롤 답변이 화면에 있으면 그쪽으로 갈 수 있게 한다.
    function rsNoteMissing(id, reason) {
        const m = rs.byId.get(id);
        let altId = '';
        if (m && m.role !== 'user' && m.parentTurnId) {
            const shown = (rs.replies.get(m.parentTurnId) || []).find(reply => reply._id !== id && rsFindGroup(reply._id));
            if (shown) altId = shown._id;
        }
        rs.notices.set(id, { reason, altId });
        rsRenderList();
        rsRenderBm();
        showTunerToast(altId ? '리롤로 다른 버전이 화면에 떠 있어요' : reason === 'stalled' ? '더 이전 대화를 불러오지 못했어요' : '지워졌거나 리롤로 바뀐 메시지 같아요');
    }

    function rsNoticeEl(id) {
        const notice = rs.notices.get(id);
        if (!notice) return null;
        const box = ctEl('div', 'crs-notice');
        box.append(ctEl('span', '', notice.altId
            ? '이 답변은 리롤로 가려져 있어요. 화면에는 다른 버전이 떠 있어요.'
            : notice.reason === 'stalled' ? '더 이전 대화를 불러오지 못해 찾지 못했어요.' : '지워졌거나 리롤로 바뀐 메시지 같아요.'));
        if (notice.altId) {
            const button = rsBtn('표시된 버전 보기', 'alt');
            button.dataset.alt = notice.altId;
            box.append(button);
        }
        return box;
    }

    function rsBtn(text, act, primary = false) {
        const button = ctEl('button', `crs-btn${primary ? ' is-primary' : ''}`, text);
        button.type = 'button';
        button.dataset.act = act;
        return button;
    }

    // ---------- 1.6.0: 메시지 안 차례 이동 · 도착 깜빡임 ----------
    function rsRangesIn(group, q) {
        const ranges = [];
        if (!group || !q) return ranges;
        const blocks = group.querySelectorAll('.wrtn-markdown');
        for (const block of blocks.length ? blocks : [group]) {
            const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                if (node.parentElement?.closest('button, #crack-room-search, .crs-bm-mark')) continue;
                const hay = node.nodeValue.toLowerCase();
                let from = 0;
                let at;
                while ((at = hay.indexOf(q, from)) >= 0) {
                    const range = new Range();
                    range.setStart(node, at);
                    range.setEnd(node, at + q.length);
                    ranges.push(range);
                    from = at + q.length;
                }
            }
        }
        return ranges;
    }

    function rsRefreshOcc() {
        const occ = rs.occ;
        if (!occ) return false;
        if (occ.ranges.some(range => !range.startContainer.isConnected)) {
            occ.ranges = rsRangesIn(rsFindGroup(occ.id), rs.query.trim().toLowerCase());
            occ.index = occ.ranges.length ? Math.min(Math.max(occ.index, 0), occ.ranges.length - 1) : -1;
        }
        return occ.ranges.length > 0;
    }

    function rsShowOcc(group) {
        const occ = rs.occ;
        if (!occ) return;
        rsScrollToTarget(occ.ranges[occ.index] || null, group || rsFindGroup(occ.id));
        rsApplyHighlights();
    }

    function rsScrollToTarget(range, group) {
        if (!group) return;
        const scroller = rsScrollContainer();
        const page = scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body;
        const box = page ? { top: 0, height: window.innerHeight } : scroller.getBoundingClientRect();
        let rect = range ? range.getBoundingClientRect() : null;
        let delta;
        if (rect && (rect.width || rect.height)) {
            delta = rect.top + rect.height / 2 - (box.top + box.height / 2);
        } else {
            rect = group.getBoundingClientRect();
            delta = rect.height > box.height * 0.8 ? rect.top - (box.top + 72) : rect.top + rect.height / 2 - (box.top + box.height / 2);
        }
        if (Math.abs(delta) < 2) return;
        if (page) window.scrollBy({ top: delta, behavior: 'smooth' });
        else scroller.scrollBy({ top: delta, behavior: 'smooth' });
    }

    function rsHideFlash() {
        clearTimeout(rs.flashTimer);
        clearTimeout(rs.flashFade);
        rs.flashCleanup?.();
        const flash = document.getElementById('crack-room-search-flash');
        if (flash) { flash.hidden = true; flash.classList.remove('is-fading'); }
    }

    // 찾아간 메시지에 테두리를 잠깐 띄운다. 크랙 요소는 건드리지 않고 위에 겹친다.
    function rsFlash(group) {
        let flash = document.getElementById('crack-room-search-flash');
        if (!flash) {
            flash = ctEl('div');
            flash.id = 'crack-room-search-flash';
            flash.setAttribute('aria-hidden', 'true');
            document.body.appendChild(flash);
        }
        rsHideFlash();
        let frame = 0;
        const place = () => {
            frame = 0;
            if (!group.isConnected) { flash.hidden = true; return; }
            const rect = group.getBoundingClientRect();
            const top = Math.max(rect.top - 6, 0);
            const bottom = Math.min(rect.bottom + 6, window.innerHeight);
            flash.hidden = bottom <= top;
            Object.assign(flash.style, { left: `${Math.max(rect.left - 8, 0)}px`, top: `${top}px`, width: `${Math.min(rect.width + 16, window.innerWidth)}px`, height: `${Math.max(0, bottom - top)}px` });
        };
        const onScroll = () => { if (!frame) frame = requestAnimationFrame(place); };
        place();
        document.addEventListener('scroll', onScroll, { capture: true, passive: true });
        rs.flashCleanup = () => {
            document.removeEventListener('scroll', onScroll, { capture: true });
            cancelAnimationFrame(frame);
            rs.flashCleanup = null;
        };
        rs.flashFade = setTimeout(() => flash.classList.add('is-fading'), 1400);
        rs.flashTimer = setTimeout(() => {
            rs.flashCleanup?.();
            flash.hidden = true;
            flash.classList.remove('is-fading');
        }, 2200);
    }

    // 서버에서 못 받았을 때: 화면에 불러온 메시지만으로 찾는다.
    // 화면에 그려진 메시지 글. 본문 블록이 없으면 버튼·메뉴(다른 확프 것 포함)를 뺀 나머지 글을 쓴다.
    function rsGroupText(group) {
        const blocks = group.querySelectorAll('.wrtn-markdown');
        if (blocks.length) return [...blocks].map(block => block.innerText || block.textContent || '').join('\n');
        const copy = group.cloneNode(true);
        copy.querySelectorAll('button, [role="button"], [role="menu"], [aria-haspopup], svg, style, script, .crs-bm-mark').forEach(el => el.remove());
        return copy.textContent || '';
    }

    function rsUseDomFallback() {
        const messages = [];
        for (const group of document.querySelectorAll('div[data-message-group-id]')) {
            const id = group.getAttribute('data-message-group-id') || '';
            const text = rsClean(rsGroupText(group));
            if (!text) continue;
            messages.push({ id, role: '', turn: 0, back: 0, text, norm: rsNorm(text), tnum: rsTurnNumber(text), dom: true });
        }
        rs.messages = messages;
        rs.msgById = new Map(messages.map(m => [m.id, m]));
        rs.domOnly = true;
        rsRunSearch();
    }

    // ---------- 화면 속 표시 (1.4.2와 같은 노랑/주황) ----------
    function rsHighlightSupported() {
        return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
    }

    function rsClearHighlights() {
        if (!rsHighlightSupported()) return;
        CSS.highlights.delete(RS_ALL_HL);
        CSS.highlights.delete(RS_CUR_HL);
    }

    function rsApplyHighlights() {
        rsClearHighlights();
        if (!rs.open || !rsHighlightSupported()) return;
        const q = rs.query.trim().toLowerCase();
        if (!q) return;
        const currentId = rs.results[rs.index]?.m.id || '';
        const all = new Highlight();
        const current = new Highlight();
        current.priority = 1;
        // 메시지 안 차례 이동 중이면 지금 그 한 군데만 주황으로 칠한다.
        const occRange = rs.occ && rs.occ.id === currentId && rsRefreshOcc() ? rs.occ.ranges[rs.occ.index] : null;
        for (const group of document.querySelectorAll('div[data-message-group-id]')) {
            const isCurrent = !occRange && group.getAttribute('data-message-group-id') === currentId;
            for (const range of rsRangesIn(group, q)) (isCurrent ? current : all).add(range);
        }
        if (occRange) current.add(occRange);
        if (all.size) CSS.highlights.set(RS_ALL_HL, all);
        if (current.size) CSS.highlights.set(RS_CUR_HL, current);
    }

    function rsScheduleHighlights(delay = 120) {
        clearTimeout(rs.hlTimer);
        rs.hlTimer = setTimeout(rsApplyHighlights, delay);
    }

    function rsStartHighlightWatch() {
        rsStopHighlightWatch();
        // 새 메시지가 그려지거나 예전 대화를 불러오면 표시를 다시 단다.
        rs.hlObserver = new MutationObserver(records => {
            if (!rs.query.trim()) return;
            if (records.every(record => record.target instanceof Element && record.target.closest?.('#crack-room-search'))) return;
            rsScheduleHighlights(400);
        });
        rs.hlObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    function rsStopHighlightWatch() {
        rs.hlObserver?.disconnect();
        rs.hlObserver = null;
        clearTimeout(rs.hlTimer);
    }

    // ---------- 1.6.0: 탭 ----------
    function rsSetTab(tab) {
        rs.tab = tab === 'bm' || tab === 'hl' ? tab : 'search';
        hpRememberTab(rs.tab);
        if (rs.tab === 'search') rs.bmEditId = '';
        if (rs.tab === 'bm' && rs.chatId) rsBmEnsure(rs.chatId);
        rsRenderTabs();
        rsRenderBm();
        rsRenderStatus();
        if (rs.tab === 'hl') hpRenderPanel(true);
        if (rs.tab === 'search') requestAnimationFrame(() => rs.root?.querySelector('.crs-input')?.focus({ preventScroll: true }));
    }

    function rsRenderTabs() {
        if (!rs.root) return;
        rs.root.dataset.tab = rs.tab;
        const tabs = rs.root.querySelector('.crs-tabs');
        tabs.style.setProperty('--i', rs.tab === 'hl' ? '2' : rs.tab === 'bm' ? '1' : '0');
        tabs.querySelectorAll('[data-tab]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.tab === rs.tab)));
        const count = rs.bm.chatId === rs.chatId ? rs.bm.items.length : 0;
        tabs.querySelector('.crs-tab-count').textContent = count ? String(count) : '';
        const hlCount = hpRoomRecs(rs.chatId).length;
        tabs.querySelector('.crs-hl-count').textContent = hlCount ? String(hlCount) : '';
        hpSyncBmTools();
        if (rs.tab === 'hl') hpRenderPanel();
    }

    // ---------- 1.6.0: 북마크 (방마다 브라우저 DB에 저장, 메시지 ··· 메뉴로 넣는다) ----------
    function rsBmSet(chatId, items) {
        rs.bm.chatId = chatId;
        rs.bm.items = items;
        rs.bm.ids = new Set(items.map(b => b.messageId));
    }

    function rsBmEnsure(chatId) {
        if (!chatId) return Promise.resolve();
        if (rs.bm.chatId === chatId) return Promise.resolve();
        if (rs.bm.loading && rs.bm.loadingId === chatId) return rs.bm.loading;
        rs.bm.loadingId = chatId;
        const loading = rsBmRead(chatId).then(items => {
            if (rs.bm.loadingId !== chatId) return;
            rsBmSet(chatId, items);
            rs.bm.loading = null;
            rsMarksSchedule(0);
            if (rs.root) {
                rsRenderTabs();
                rsRenderBm();
                rsRenderStatus();
                rsRenderList();
            }
        });
        rs.bm.loading = loading;
        return loading;
    }

    async function rsBmCommit(chatId, items) {
        const ok = await rsBmWrite(chatId, items);
        if (!ok) {
            rsToast(rs.dbBlocked ? '다른 크랙 탭을 새로고침하면 북마크를 저장할 수 있어요' : '북마크를 저장하지 못했어요');
            return false;
        }
        if (rsChatIdFromPath() === chatId) rsBmSet(chatId, items);
        rsMarksSchedule(0);
        if (rs.root) {
            rsRenderTabs();
            rsRenderBm();
            rsRenderStatus();
            rsRenderList();
        }
        return true;
    }

    function rsBmInfo(id) {
        const m = rs.msgById.get(id) || null;
        const raw = rs.byId.get(id) || null;
        const group = rsFindGroup(id);
        let text = m?.text || '';
        if (!text && group) text = rsGroupText(group);
        const flat = rsClean(text).replace(/\s+/g, ' ').trim();
        const preview = flat.length > 400 ? `${flat.slice(0, 400)}…` : flat;
        const title = !preview ? '저장한 메시지' : preview.length > 28 ? `${preview.slice(0, 28).trimEnd()}…` : preview;
        const role = raw?.role || m?.role || '';
        return { messageId: id, turnId: raw?.turnId || m?.turnId || '', parentTurnId: raw?.parentTurnId || '', role, turnLabel: m ? rsTurnLabel(m) : '', preview, title };
    }

    async function rsBmToggle(id) {
        const chatId = rsChatIdFromPath();
        if (!chatId || !RS_ID.test(id)) return;
        await rsBmEnsure(chatId);
        const items = rs.bm.chatId === chatId ? rs.bm.items.slice() : [];
        const at = items.findIndex(b => b.messageId === id);
        if (at >= 0) {
            const [removed] = items.splice(at, 1);
            if (rs.bmOpenId === id) rs.bmOpenId = '';
            if (await rsBmCommit(chatId, items)) rsToast('북마크를 지웠어요', { actionLabel: '되돌리기', onAction: () => rsBmRestore(chatId, removed) });
            return;
        }
        const now = Date.now();
        items.push({ v: 1, chatId, ...rsBmInfo(id), memo: '', createdAt: now, updatedAt: now });
        if (await rsBmCommit(chatId, items)) rsToast('북마크에 저장했어요', { actionLabel: '이름 편집', onAction: () => rsOpenBookmark(id, { edit: true }) });
    }

    async function rsBmRestore(chatId, bookmark) {
        await rsBmEnsure(chatId);
        if (rs.bm.chatId !== chatId || rs.bm.ids.has(bookmark.messageId)) return;
        await rsBmCommit(chatId, [...rs.bm.items, bookmark]);
    }

    function rsBmUpdate(id, changes) {
        const chatId = rs.bm.chatId;
        if (!chatId) return Promise.resolve(false);
        return rsBmCommit(chatId, rs.bm.items.map(b => (b.messageId === id ? { ...b, ...changes, updatedAt: Date.now() } : b)));
    }

    // 전체 로그를 받은 뒤 북마크의 턴 표시와 대체 식별자(turnId)를 채운다.
    function rsBmEnrich() {
        const chatId = rs.chatId;
        if (!chatId || rs.bm.chatId !== chatId || !rs.byId.size) return;
        let changed = false;
        const items = rs.bm.items.map(b => {
            const raw = rs.byId.get(b.messageId);
            const m = rs.msgById.get(b.messageId);
            if (!raw && !m) return b;
            const turnLabel = m ? rsTurnLabel(m) : b.turnLabel;
            if (b.turnId && b.role && b.turnLabel === turnLabel) return b;
            changed = true;
            return { ...b, turnId: b.turnId || raw?.turnId || '', parentTurnId: b.parentTurnId || raw?.parentTurnId || '', role: raw?.role || b.role || '', turnLabel };
        });
        if (changed) rsBmCommit(chatId, items);
    }

    function rsOpenBookmark(id, { edit = false } = {}) {
        if (!rs.open) rsOpen({ focus: false });
        rsSetTab('bm');
        if (rs.root?.classList.contains('is-mobile')) rsSetListOpen(true);
        rs.bmOpenId = id;
        rs.bmEditId = edit ? id : '';
        rsRenderBm();
        if (edit) requestAnimationFrame(() => {
            const input = rs.root?.querySelector('.crs-edit-title');
            input?.focus();
            input?.select();
        });
    }

    async function rsBmGoto(bookmark) {
        let id = bookmark.messageId;
        // 메시지를 고쳐 id가 바뀌었으면 같은 turnId의 새 메시지로 북마크를 옮긴다.
        if (!rsFindGroup(id) && rs.complete && !rs.byId.has(id) && bookmark.turnId) {
            const moved = rs.byTurn.get(bookmark.turnId);
            if (moved && moved._id !== id && !rs.bm.ids.has(moved._id)) {
                await rsBmUpdate(id, { messageId: moved._id });
                rs.bmOpenId = moved._id;
                rsRenderBm();
                rsToast('수정된 메시지로 북마크 위치를 맞췄어요');
                id = moved._id;
            }
        }
        rsGoto(id);
    }

    async function rsBmSaveEdit() {
        const id = rs.bmEditId;
        if (!id || !rs.root) return;
        const title = (rs.root.querySelector('.crs-edit-title')?.value || '').trim().slice(0, 120);
        const memo = (rs.root.querySelector('.crs-edit-memo')?.value || '').slice(0, 2000);
        rs.bmEditId = '';
        await rsBmUpdate(id, { title: title || '저장한 메시지', memo });
    }

    function rsOnBmAction(act, id) {
        if (act === 'bmtoggle') {
            rs.bmOpenId = rs.bmOpenId === id ? '' : id;
            rs.bmEditId = '';
            rsRenderBm();
            return;
        }
        const bookmark = rs.bm.items.find(b => b.messageId === id);
        if (act === 'bmcancel') { rs.bmEditId = ''; rsRenderBm(); return; }
        if (act === 'bmsave') { rsBmSaveEdit(); return; }
        if (!bookmark) return;
        if (act === 'bmgoto') rsBmGoto(bookmark);
        else if (act === 'bmdel') rsBmToggle(id);
        else if (act === 'bmedit') {
            rs.bmOpenId = id;
            rs.bmEditId = id;
            rsRenderBm();
            requestAnimationFrame(() => {
                const input = rs.root?.querySelector('.crs-edit-title');
                input?.focus();
                input?.select();
            });
        }
    }

    function rsBmWhen(ts) {
        const date = new Date(Number(ts) || Date.now());
        const now = new Date();
        const day = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const diff = Math.round((day(now) - day(date)) / 86400000);
        if (diff === 0) return `오늘 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        if (diff === 1) return '어제';
        return `${date.getMonth() + 1}월 ${date.getDate()}일`;
    }

    function rsBmItem(b) {
        const open = rs.bmOpenId === b.messageId;
        const editing = rs.bmEditId === b.messageId;
        const item = ctEl('div', `crs-bm-item${open || editing ? ' is-open' : ''}`);
        item.dataset.id = b.messageId;
        item.setAttribute('role', 'listitem');
        const meta = ctEl('span', 'crs-item-meta');
        const who = b.role === 'user' ? '나' : b.role ? '캐릭터' : '';
        meta.append(ctEl('span', 'crs-chip', b.turnLabel || '메시지'), ctEl('span', 'crs-who', `${who ? `${who} · ` : ''}${rsBmWhen(b.createdAt)}`));
        if (editing) {
            const form = ctEl('div', 'crs-edit');
            const field = (label, control) => {
                const wrap = ctEl('label', 'crs-edit-field');
                wrap.append(ctEl('span', '', label), control);
                return wrap;
            };
            const title = ctEl('input', 'crs-edit-title');
            title.type = 'text';
            title.maxLength = 120;
            title.value = b.title || '';
            const memo = ctEl('textarea', 'crs-edit-memo');
            memo.rows = 3;
            memo.maxLength = 2000;
            memo.value = b.memo || '';
            const actions = ctEl('div', 'crs-bm-actions');
            actions.append(rsBtn('저장', 'bmsave', true), rsBtn('취소', 'bmcancel'), ctEl('span', 'crs-edit-hint', 'Enter 저장 · Esc 취소'));
            form.append(meta, field('이름', title), field('메모', memo), actions);
            item.append(form);
            return item;
        }
        const head = ctEl('button', 'crs-bm-head');
        head.type = 'button';
        head.dataset.act = 'bmtoggle';
        head.setAttribute('aria-expanded', String(open));
        const titleRow = ctEl('span', 'crs-bm-title');
        titleRow.innerHTML = rsStar(16, true);
        titleRow.append(ctEl('span', 'crs-bm-name', b.title || '저장한 메시지'));
        if (open) {
            const chevron = ctEl('span', 'crs-chev');
            chevron.innerHTML = RS_ICON.up;
            titleRow.append(chevron);
        }
        head.append(titleRow, meta, ctEl('span', 'crs-bm-preview', b.preview || ''));
        if (b.memo) {
            const memo = ctEl('span', 'crs-bm-memo');
            memo.innerHTML = RS_ICON.note;
            memo.append(ctEl('span', '', b.memo));
            head.append(memo);
        }
        item.append(head);
        if (open) {
            const body = ctEl('div', 'crs-bm-body');
            const notice = rsNoticeEl(b.messageId);
            if (notice) body.append(notice);
            const actions = ctEl('div', 'crs-bm-actions');
            const remove = ctEl('button', 'crs-icon crs-bm-del');
            remove.type = 'button';
            remove.dataset.act = 'bmdel';
            remove.title = '북마크 지우기';
            remove.setAttribute('aria-label', '북마크 지우기');
            remove.innerHTML = RS_ICON.trash;
            actions.append(rsBtn('대화에서 보기', 'bmgoto', true), rsBtn('이름·메모', 'bmedit'), remove);
            body.append(actions);
            item.append(body);
        }
        return item;
    }

    function rsRenderBm() {
        if (!rs.root) return;
        if (hp.bmScope === 'all') { if (rs.tab === 'bm') hpRenderBmAll(); return; }
        const items = rs.bm.chatId === rs.chatId ? rs.bm.items.slice() : [];
        if (rs.bmSort === 'chat') items.sort((a, b) => (a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0));
        else items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        rs.root.querySelector('.crs-bm-count').textContent = items.length ? `이 방 북마크 ${items.length}개` : '';
        const select = rs.root.querySelector('.crs-bm-sort');
        if (select.value !== rs.bmSort) select.value = rs.bmSort;
        const frag = document.createDocumentFragment();
        if (!items.length) frag.append(ctEl('div', 'crs-empty', '메시지 ··· 메뉴의 「북마크」로 저장하면 여기에 모여요'));
        for (const bookmark of items) frag.append(rsBmItem(bookmark));
        const list = rs.root.querySelector('.crs-bm-list');
        const draft = rsBmDraft(list);
        list.replaceChildren(frag);
        if (draft) rsBmKeepDraft(list, draft);
    }

    function rsBmDraft(list) {
        if (!rs.bmEditId) return null;
        const form = [...list.querySelectorAll('.crs-bm-item')].find(item => item.dataset.id === rs.bmEditId)?.querySelector('.crs-edit');
        if (!form) return null;
        const fields = ['.crs-edit-title', '.crs-edit-memo'].map(selector => form.querySelector(selector));
        const active = fields.findIndex(field => field && field === document.activeElement);
        const focused = fields[active];
        return {
            id: rs.bmEditId,
            values: fields.map(field => field?.value ?? null),
            active,
            selection: focused ? [focused.selectionStart, focused.selectionEnd] : null
        };
    }

    function rsBmKeepDraft(list, draft) {
        if (draft.id !== rs.bmEditId) return;
        const form = [...list.querySelectorAll('.crs-bm-item')].find(item => item.dataset.id === draft.id)?.querySelector('.crs-edit');
        if (!form) return;
        const fields = ['.crs-edit-title', '.crs-edit-memo'].map(selector => form.querySelector(selector));
        fields.forEach((field, i) => { if (field && draft.values[i] !== null) field.value = draft.values[i]; });
        const focused = fields[draft.active];
        if (!focused) return;
        focused.focus({ preventScroll: true });
        if (draft.selection) try { focused.setSelectionRange(draft.selection[0], draft.selection[1]); } catch (e) {}
    }

    // 메시지 ··· 메뉴에 「북마크」를 넣는다(복사 바로 아래).
    function rsMenuGroup(menu) {
        const ids = String(menu.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
        for (const id of ids) {
            const group = document.getElementById(id)?.closest?.('div[data-message-group-id]');
            if (group) return group;
        }
        const open = document.querySelector('div[data-message-group-id] [aria-haspopup="menu"][data-state="open"]');
        return open?.closest('div[data-message-group-id]') || (rs.menuGroupId ? rsFindGroup(rs.menuGroupId) : null);
    }

    function rsInjectMessageMenu(menu) {
        if (!(menu instanceof HTMLElement) || !rsChatIdFromPath()) return;
        if (menu.querySelector('.crs-menu-bm')) return;
        const texts = [...menu.querySelectorAll('[role="menuitem"]')].map(item => (item.textContent || '').replace(/\s+/g, ' ').trim());
        if (!texts.some(text => text === '수정' || text === '삭제') || texts.some(text => text.includes('고정'))) return;
        const group = rsMenuGroup(menu);
        const id = group?.getAttribute('data-message-group-id') || '';
        if (!RS_ID.test(id)) return;
        const saved = rs.bm.chatId === rsChatIdFromPath() && rs.bm.ids.has(id);
        const item = ctEl('div', 'crack-smart-organize-menu-item crs-menu-bm');
        item.setAttribute('role', 'menuitem');
        item.setAttribute('tabindex', '-1');
        const icon = ctEl('span', 'crack-smart-organize-menu-icon crs-menu-star');
        icon.innerHTML = rsStar(16, saved);
        item.append(icon, ctEl('span', 'crack-smart-organize-menu-label', saved ? '북마크 해제' : '북마크'));
        const run = () => {
            closeRadixMenu(menu);
            rsBmToggle(id);
        };
        item.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); }, true);
        item.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            run();
        }, true);
        item.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
            run();
        });
        const copy = menu.querySelector('.ccb-context-copy-item');
        if (copy) copy.after(item);
        else menu.prepend(item);
    }

    // 북마크한 메시지에만 아래 도구 줄에 작은 ★를 붙인다(누르면 해제, 되돌리기 가능).
    function rsToolArea(group) {
        const triggers = [...group.querySelectorAll('[aria-haspopup="menu"]')].filter(element => !element.closest('.crs-bm-mark'));
        const trigger = triggers.find(element => element.querySelector('[aria-label="메시지 옵션"]')) || triggers[triggers.length - 1];
        const area = trigger?.parentElement;
        if (area && area !== group && group.contains(area)) {
            const style = getComputedStyle(area);
            if (style.display.includes('flex') && !style.flexDirection.startsWith('column')) return { area, mode: 'inline' };
        }
        let element = group.querySelector('.wrtn-markdown')?.parentElement;
        while (element && element !== group) {
            if (getComputedStyle(element).position !== 'static') return { area: element, mode: 'corner' };
            element = element.parentElement;
        }
        return null;
    }

    function rsMarksSchedule(delay = 250) {
        if (rs.marksTimer) return;
        rs.marksTimer = setTimeout(() => {
            rs.marksTimer = 0;
            rsMarksSync();
        }, delay);
    }

    function rsMarksSync() {
        const chatId = rsChatIdFromPath();
        const ids = chatId && rs.bm.chatId === chatId ? rs.bm.ids : new Set();
        for (const mark of document.querySelectorAll('.crs-bm-mark')) {
            const group = mark.closest('div[data-message-group-id]');
            if (!group || !ids.has(mark.dataset.id) || group.getAttribute('data-message-group-id') !== mark.dataset.id) mark.remove();
        }
        for (const id of ids) {
            const group = rsFindGroup(id);
            if (!group || group.querySelector('.crs-bm-mark')) continue;
            const place = rsToolArea(group);
            if (!place) continue;
            const mark = document.createElement('button');
            mark.type = 'button';
            mark.className = `crs-bm-mark${place.mode === 'inline' ? '' : ` is-${place.mode}`}`;
            mark.dataset.id = id;
            mark.title = '북마크됨 · 누르면 해제';
            mark.setAttribute('aria-label', '북마크됨 · 누르면 해제');
            mark.innerHTML = rsStar(16, true);
            mark.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                rsBmToggle(id);
            });
            if (place.mode === 'corner') place.area.append(mark);
            else place.area.insertBefore(mark, place.area.firstChild);
        }
    }

    function rsToast(text, { actionLabel = '', onAction = null, duration = 3600 } = {}) {
        let toast = document.getElementById('crack-room-search-toast');
        if (!toast) {
            toast = ctEl('div');
            toast.id = 'crack-room-search-toast';
            toast.setAttribute('role', 'status');
            document.body.appendChild(toast);
        }
        clearTimeout(rs.toastTimer);
        const icon = ctEl('span', 'crs-toast-icon');
        icon.innerHTML = rsStar(16, true);
        const parts = [icon, ctEl('span', 'crs-toast-text', text)];
        if (actionLabel && onAction) {
            const button = ctEl('button', '', actionLabel);
            button.type = 'button';
            button.addEventListener('click', () => {
                toast.classList.remove('is-on');
                onAction();
            });
            parts.push(button);
        }
        toast.replaceChildren(...parts);
        rsPlaceToast(toast);
        requestAnimationFrame(() => toast.classList.add('is-on'));
        rs.toastTimer = setTimeout(() => toast.classList.remove('is-on'), duration);
    }

    function rsPlaceToast(toast) {
        const card = rs.open && rs.root?.classList.contains('is-mobile') && rsVisible(rs.root) ? rs.root : null;
        const anchor = card || rsFindComposerContainer(rsFindComposerEditable());
        const rect = anchor && rsVisible(anchor) ? anchor.getBoundingClientRect() : null;
        if (!rect || rect.top <= 80) {
            toast.style.removeProperty('left');
            toast.style.removeProperty('bottom');
            return;
        }
        const half = Math.min(toast.offsetWidth, window.innerWidth - 32) / 2;
        const center = Math.max(16 + half, Math.min(window.innerWidth - 16 - half, rect.left + rect.width / 2));
        toast.style.left = `${Math.round(center)}px`;
        toast.style.bottom = `${Math.round(window.innerHeight - rect.top + 12)}px`;
    }

    // ---------- 입력 ----------
    function rsOnInput(event) {
        if (hpOnPanelInput(event)) return;
        if (!event.target.classList?.contains('crs-input')) return;
        rs.query = event.target.value || '';
        clearTimeout(rs.queryTimer);
        rs.queryTimer = setTimeout(() => {
            rs.expandedId = '';
            rs.shown = RS_RESULT_STEP;
            rsRunSearch({ keepCurrent: false });
            const list = rs.root?.querySelector('.crs-list');
            if (list) list.scrollTop = 0;
        }, 160);
    }

    function rsOnKeydown(event) {
        event.stopPropagation();
        if (event.isComposing || event.keyCode === 229) return;
        if (hpOnPanelKeydown(event)) { event.preventDefault(); return; }
        if (event.key === 'Escape') {
            event.preventDefault();
            if (hpPanelEsc()) return;
            if (rs.bmEditId) { rs.bmEditId = ''; rsRenderBm(); }
            else if (rs.jump) rsStopJump();
            else if (rs.listOpen) rsSetListOpen(false);
            else rsClose();
            return;
        }
        if (event.key === 'Enter' && (event.target.classList?.contains('crs-edit-title') || ((event.ctrlKey || event.metaKey) && event.target.classList?.contains('crs-edit-memo')))) {
            event.preventDefault();
            rsBmSaveEdit();
            return;
        }
        if (event.key === 'Enter' && event.target.classList?.contains('crs-input')) {
            event.preventDefault();
            clearTimeout(rs.queryTimer);
            const value = event.target.value || '';
            if (value !== rs.query || !rs.results.length) {
                rs.query = value;
                rsRunSearch({ keepCurrent: false });
                if (rs.results.length) rsStep(0);
                return;
            }
            rsStep(event.shiftKey ? -1 : 1);
        }
    }

    function rsOnChange(event) {
        if (!event.target.classList?.contains('crs-bm-sort')) return;
        rs.bmSort = event.target.value === 'chat' ? 'chat' : 'recent';
        try { localStorage.setItem(RS_BM_SORT_KEY, rs.bmSort); } catch (e) {}
        rsRenderBm();
    }

    function rsOnClick(event) {
        const target = event.target;
        const tab = target.closest('.crs-tabs [data-tab]');
        if (tab) {
            rsSetTab(tab.dataset.tab);
            return;
        }
        const hpEl = target.closest('[data-act^="hp"]');
        if (hpEl) { hpOnPanelAct(hpEl.dataset.act, hpEl); return; }
        const filter = target.closest('[data-filter]');
        if (filter) {
            rs.filter = filter.dataset.filter;
            rs.shown = RS_RESULT_STEP;
            rsRunSearch({ keepCurrent: false });
            rsRenderAll();
            return;
        }
        const el = target.closest('[data-act]');
        if (!el) return;
        const act = el.dataset.act;
        const item = el.closest('.crs-item');
        if (act === 'close') rsClose();
        else if (act === 'prev') rsStep(-1);
        else if (act === 'next') rsStep(1);
        else if (act === 'sort') {
            rs.sort = rs.sort === 'old' ? 'new' : 'old';
            rsSaveSort();
            rsRunSearch();
            rsRenderAll();
            requestAnimationFrame(rsScrollCurrentIntoView);
        } else if (act === 'refresh' || act === 'retry') rsLoad({ force: true });
        else if (act === 'stop') rsStopLoad();
        else if (act === 'jumpstop') rsStopJump();
        else if (act === 'list') {
            if (rs.jump) rsStopJump();
            else rsSetListOpen(!rs.listOpen);
        } else if (act === 'other') rsSearchOtherRooms();
        else if (act === 'more') {
            rs.shown += RS_RESULT_STEP;
            rsRenderList();
        } else if (act === 'toggle' && item) rsToggleItem(item.dataset.id, Number(item.dataset.i));
        else if (act === 'goto' && item) rsGoto(item.dataset.id);
        else if (act === 'alt' && el.dataset.alt) rsGoto(el.dataset.alt);
        else if (act.startsWith('bm')) rsOnBmAction(act, el.closest('.crs-bm-item')?.dataset.id || '');
    }

    // 튜너의 채팅방 검색창(제목·최근 메시지)에 같은 말을 넣는다.
    function rsSearchOtherRooms() {
        const q = rs.query.trim();
        const input = document.querySelector('.crack-search-input');
        if (!input || !input.getClientRects().length) {
            showTunerToast('왼쪽 채팅 목록을 열면 다른 채팅방에서도 찾을 수 있어요');
            return;
        }
        const toggle = document.querySelector('.crack-search-message-toggle');
        if (q && toggle && toggle.getAttribute('aria-pressed') !== 'true') toggle.click();
        input.value = q;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
    }

    // ---------- 전송 버튼 옆 돋보기 (1.4.2의 자리 찾기 방식) ----------
    function rsVisible(element) {
        if (!element || !element.isConnected) return false;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        const rect = element.getBoundingClientRect();
        return rect.width >= 8 && rect.height >= 8;
    }

    function rsButtonLabel(button) {
        return [button.getAttribute('aria-label'), button.getAttribute('title'), button.getAttribute('data-testid'), button.getAttribute('data-name'), button.textContent]
            .filter(Boolean).join(' ').trim().toLowerCase();
    }

    function rsFindComposerEditable() {
        const candidates = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]
            .filter(element => !element.closest('#crack-room-search, #crack-lounge, .crack-search-container, [role="dialog"]'))
            .filter(rsVisible)
            .map(element => ({ element, rect: element.getBoundingClientRect() }))
            .filter(({ rect }) => rect.top > window.innerHeight * 0.42)
            .sort((a, b) => b.rect.bottom - a.rect.bottom);
        return candidates[0]?.element || null;
    }

    function rsFindComposerContainer(editable) {
        if (!editable) return null;
        let element = editable.parentElement;
        for (let depth = 0; element && depth < 7; depth++) {
            const rect = element.getBoundingClientRect();
            const buttons = element.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]').length;
            // 입력칸과 버튼을 함께 감싼 가장 가까운 상자. 더 올라가면 헤더 버튼까지 섞일 수 있다.
            if (buttons > 0 && rect.width >= 240 && rect.bottom > window.innerHeight * 0.7) return element;
            element = element.parentElement;
        }
        return null;
    }

    // 크랙 입력창 아래 줄의 왼쪽 도구 묶음인지. 10/08 크랙 업데이트로 space-x-2가 gap-2로 바뀌어 둘 다 받는다.
    // 입력창 아래 줄(justify-between)의 바로 아래 자식만 넘어오므로 흔한 gap-2도 여기서는 묶음으로 본다. id가 있는 다른 확프 상자는 뺀다.
    function rsIsCrackToolbar(element) {
        return element instanceof Element && !element.id
            && element.matches('.flex.items-center.space-x-2, .flex.items-center.gap-2');
    }

    function rsFindSendButton() {
        const editable = rsFindComposerEditable();
        const container = rsFindComposerContainer(editable) || document;
        const containerRect = container === document ? null : container.getBoundingClientRect();
        if (container !== document) {
            // 크랙 입력창은 왼쪽 도구 묶음과 전송 버튼이 같은 justify-between 줄의 바로 아래 자식이다.
            for (const row of [...container.querySelectorAll('.flex.items-center.justify-between')].filter(rsVisible)) {
                if (![...row.children].some(child => rsIsCrackToolbar(child))) continue;
                const direct = [...row.children].filter(child => child !== rs.launcher && child.matches('button') && rsVisible(child));
                const primary = direct.find(button => button.classList.contains('bg-primary') && button.classList.contains('rounded-full'));
                if (primary) return primary;
                if (direct.length) return direct[direct.length - 1];
            }
        }
        // 1.6.2: 입력창 상자를 못 찾아 문서 전체를 볼 때(새 방을 여는 중 등)는 창(dialog) 밖의 '보내기' 단추만 믿는다.
        // 아무 단추나 고르면 다른 확프 창(위시 창의 「취소」 옆)에 들어갔고, 그 창이 다시 그리면서 돋보기를 자기 「취소」 단추로 덮어썼다.
        const wholePage = container === document;
        const candidates = [...container.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')]
            .filter(button => button !== rs.launcher && !button.closest('#crack-room-search') && rsVisible(button))
            .filter(button => !wholePage || !button.closest('[role="dialog"], [aria-modal="true"], [role="menu"]'))
            .map(button => {
                const rect = button.getBoundingClientRect();
                const label = rsButtonLabel(button);
                let score = 0;
                if (/전송|보내기|메시지\s*전송|send/.test(label)) score += 100;
                if (button.matches('button[type="submit"], input[type="submit"]')) score += 35;
                if (rect.bottom > window.innerHeight * 0.72) score += 15;
                if (rect.left > window.innerWidth * 0.55) score += 10;
                if (containerRect) {
                    const fromRight = containerRect.right - rect.right;
                    const fromBottom = containerRect.bottom - rect.bottom;
                    if (fromRight >= -8 && fromRight <= 96) score += 30;
                    if (fromBottom >= -8 && fromBottom <= 96) score += 30;
                }
                if (editable) {
                    const editableRect = editable.getBoundingClientRect();
                    if (Math.abs((rect.top + rect.height / 2) - (editableRect.top + editableRect.height / 2)) < 60) score += 20;
                }
                return { button, rect, score };
            })
            .filter(({ rect, score }) => rect.width <= 96 && rect.height <= 96 && (!wholePage || score >= 100))
            .sort((a, b) => (b.score - a.score) || (b.rect.right - a.rect.right));
        return candidates[0]?.button || null;
    }

    function rsFindLauncherSlot(sendButton) {
        const container = sendButton.parentElement;
        if (!container) return null;
        const siblings = [...container.children].filter(element => element !== rs.launcher);
        let anchor = sendButton;
        // 전송 버튼 바로 앞에 붙어 있는 다른 확프의 작은 버튼들도 함께 묶어 그 앞에 둔다.
        for (let index = siblings.indexOf(sendButton) - 1; index >= 0; index--) {
            const element = siblings[index];
            const rect = element.getBoundingClientRect();
            // 크랙의 왼쪽 도구 묶음은 다른 확프 버튼이 아니다.
            if (rsIsCrackToolbar(element)) break;
            const buttonLike = element.matches('button, [role="button"], input[type="button"], input[type="submit"]') || !!element.querySelector('button, [role="button"], input[type="button"], input[type="submit"]');
            if (!buttonLike || !rsVisible(element) || rect.width > 72 || rect.height > 72) break;
            anchor = element;
        }
        return { container, anchor };
    }

    // 크랙 입력창 아래 줄의 왼쪽 도구 묶음. 다른 확프 버튼들도 여기에 모여 있다.
    function rsFindToolbar() {
        const container = rsFindComposerContainer(rsFindComposerEditable());
        if (!container) return null;
        for (const row of container.querySelectorAll('.flex.items-center.justify-between')) {
            if (!rsVisible(row)) continue;
            const bar = [...row.children].find(child => rsIsCrackToolbar(child));
            if (bar) return bar;
        }
        return null;
    }

    function rsEnsureLauncher() {
        if (!rsChatIdFromPath()) {
            rs.launcher?.remove();
            rs.row = null;
            return;
        }
        // 1.6.2: 다른 확프가 돋보기를 자기 단추로 덮어쓴 흔적(아이디가 사라짐)이 있으면 그 단추는 버리고 새로 만든다.
        if (rs.launcher && rs.launcher.id !== 'crack-room-search-launcher') {
            rs.launcher.remove();
            rs.launcher = null;
        }
        if (!rs.launcher) {
            const button = document.createElement('button');
            button.id = 'crack-room-search-launcher';
            button.type = 'button';
            button.className = 'relative inline-flex items-center justify-center rounded-full border border-border bg-card text-line-gray-1 hover:bg-secondary p-0 size-7 transition-colors';
            button.setAttribute('aria-label', '이 방에서 찾기');
            button.setAttribute('aria-pressed', 'false');
            button.title = '이 방에서 찾기 (Alt+Shift+F)';
            button.innerHTML = RS_ICON.launcher;
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                if (rs.open) rsClose();
                else rsOpen();
            });
            rs.launcher = button;
        }
        const launcher = rs.launcher;
        // 1.5.1: 도구 묶음 끝에 둔다. 묶음 안에 있으면 순서는 건드리지 않는다(다른 확프와 자리 다툼 방지).
        const toolbar = rsFindToolbar();
        if (toolbar) {
            launcher.classList.remove('crs-launcher-fallback');
            launcher.classList.add('crs-in-toolbar');
            launcher.style.removeProperty('margin-right');
            if (launcher.parentElement !== toolbar) toolbar.appendChild(launcher);
            rs.row = toolbar;
            return;
        }
        launcher.classList.remove('crs-in-toolbar');
        const send = rsFindSendButton();
        if (!send) {
            if (launcher.parentElement !== document.body) document.body.appendChild(launcher);
            launcher.classList.add('crs-launcher-fallback');
            rs.row = null;
            return;
        }
        const slot = rsFindLauncherSlot(send);
        if (!slot) return;
        launcher.classList.remove('crs-launcher-fallback');
        const slotStyle = getComputedStyle(slot.container);
        const gap = Number.parseFloat(slotStyle.columnGap || slotStyle.gap) || 0;
        launcher.style.marginRight = gap > 0 ? '0px' : '8px';
        const inRow = launcher.parentElement === slot.container;
        const beforeSend = inRow && !!(launcher.compareDocumentPosition(slot.anchor) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (!inRow || !beforeSend) slot.container.insertBefore(launcher, slot.anchor);
        rs.row = slot.container;
    }

    function rsSchedulePlace(delay = 250) {
        if (rs.placeTimer) return;
        rs.placeTimer = setTimeout(() => {
            rs.placeTimer = 0;
            rsEnsureLauncher();
            if (rs.open) rsSchedulePosition();
        }, delay);
    }

    // 튜너의 페이지 감시가 부른다. 무거운 일은 하지 않고, 돋보기가 빠졌을 때만 다시 둔다.
    function rsOnPageChange(routeChanged) {
        hpOnPage(routeChanged);
        if (routeChanged) {
            const chatId = rsChatIdFromPath();
            if (rs.open && chatId !== rs.chatId) rsClose();
            if (!chatId) rs.launcher?.remove();
            rs.notices.clear();
            rs.occ = null;
            rsHideFlash();
            if (chatId) rsBmEnsure(chatId);
            rsMarksSchedule(0);
        }
        if (!rsChatIdFromPath()) return;
        if (rs.bm.ids.size) rsMarksSchedule(300);
        const launcher = rs.launcher;
        if (!launcher || !launcher.isConnected || launcher.parentElement !== rs.row || launcher.classList.contains('crs-launcher-fallback') || launcher.id !== 'crack-room-search-launcher') rsSchedulePlace();
    }

    // 1.4.2의 크랙 스크롤 도우미를 그대로 옮겼다.
    function rsScrollContainer() {
        const sample = document.querySelector('div[data-message-group-id]') || document.querySelector('.wrtn-markdown');
        let element = sample?.parentElement;
        while (element && element !== document.body) {
            const style = getComputedStyle(element);
            const canScroll = /(auto|scroll)/.test(style.overflowY) || /(auto|scroll)/.test(style.overflow);
            if (canScroll && element.scrollHeight > element.clientHeight + 30) return element;
            element = element.parentElement;
        }
        return document.scrollingElement || document.documentElement;
    }

    function rsSetScrollTop(container, value) {
        if (container === document.scrollingElement || container === document.documentElement || container === document.body) window.scrollTo({ top: value, behavior: 'auto' });
        else container.scrollTop = value;
    }

    function initRoomSearch() {
        rs.sort = rsReadSort();
        hpInit();
        try { rs.bmSort = localStorage.getItem(RS_BM_SORT_KEY) === 'chat' ? 'chat' : 'recent'; } catch (e) {}
        rsSchedulePlace(0);
        const chatNow = rsChatIdFromPath();
        if (chatNow) rsBmEnsure(chatNow);
        // 메시지 ··· 메뉴가 어느 메시지 것인지 기억해 둔다(메뉴에 북마크 항목을 넣을 때 씀).
        document.addEventListener('pointerdown', event => {
            const trigger = event.target.closest?.('[aria-haspopup="menu"], .dropdown-button');
            const group = trigger?.closest('div[data-message-group-id]');
            if (group) rs.menuGroupId = group.getAttribute('data-message-group-id') || '';
        }, true);
        document.addEventListener('keydown', event => {
            if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.code !== 'KeyF') return;
            if (!rsChatIdFromPath()) return;
            event.preventDefault();
            event.stopPropagation();
            if (!rs.open) rsOpen();
            if (rs.tab !== 'search') rsSetTab('search');
            else rs.root?.querySelector('.crs-input')?.focus();
        }, true);
        window.addEventListener('resize', rsSchedulePosition, { passive: true });
        window.visualViewport?.addEventListener('resize', rsSchedulePosition, { passive: true });
        window.visualViewport?.addEventListener('scroll', rsSchedulePosition, { passive: true });
        // 예전 독립 확프가 아직 켜져 있으면 한 번만 알린다.
        setTimeout(() => {
            if (rs.warned) return;
            if (document.getElementById('crack-story-search-launcher') || document.getElementById('crack-story-search-loader-root')) {
                rs.warned = true;
                showTunerToast('「크랙 채팅방 내부 검색」은 튜너에 합쳐졌어요. TM에서 그 확프를 꺼 주세요');
            }
        }, 5000);
    }

    addCrackStyle(`
        #crack-room-search { position: fixed; z-index: 9985; display: none; flex-direction: column; box-sizing: border-box; color: var(--ct-text); background: var(--ct-menu); font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Segoe UI", sans-serif; font-size: 14px; }
        #crack-room-search * { box-sizing: border-box; }
        #crack-room-search.is-open { display: flex; }
        #crack-room-search:not(.is-mobile) { top: 0; right: 0; width: min(400px, calc(100vw - 24px)); height: 100%; border-left: 1px solid var(--ct-line2); box-shadow: var(--ct-shadow); animation: crsSlideIn 260ms var(--ct-ease); }
        @keyframes crsSlideIn { from { opacity: 0; transform: translateX(24px); } }
        #crack-room-search.is-mobile { left: 12px; right: 12px; max-height: calc(100% - 64px); padding-bottom: 12px; border: 1px solid var(--ct-line2); border-radius: 16px; box-shadow: var(--ct-shadow); animation: crsRiseIn 220ms var(--ct-ease); }
        @keyframes crsRiseIn { from { opacity: 0; transform: translateY(10px); } }
        .crs-head { display: flex; align-items: center; gap: 2px; height: 52px; flex: 0 0 auto; padding: 0 8px 0 16px; }
        .crs-title { flex: 1; min-width: 0; font-size: 15px; font-weight: 720; letter-spacing: -.01em; }
        .crs-icon { display: grid; place-items: center; width: 32px; height: 32px; flex: 0 0 32px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--ct-muted); cursor: pointer; transition: background-color 140ms, color 140ms; }
        .crs-icon:hover:not(:disabled) { background: var(--ct-hover2); color: var(--ct-text); }
        .crs-icon:disabled { opacity: .4; cursor: default; }
        .crs-icon svg { transition: transform 360ms var(--ct-spring); }
        .crs-close:hover svg { transform: rotate(90deg); }
        .crs-refresh:hover svg { transform: rotate(-120deg); }
        .crs-refresh.is-busy svg { animation: crsSpin 900ms linear infinite; }
        @keyframes crsSpin { to { transform: rotate(360deg); } }
        .crs-bar { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; height: 44px; margin: 0 16px 12px; padding: 0 4px 0 12px; border: 1px solid var(--ct-line2); border-radius: 12px; background: var(--ct-field); color: var(--ct-faint); transition: border-color 160ms, box-shadow 160ms; }
        .crs-bar:focus-within { border-color: var(--ct-muted); box-shadow: 0 0 0 3px var(--ct-ring); }
        .crs-bar > svg { flex: 0 0 auto; }
        .crs-input { flex: 1; min-width: 0; height: 38px; padding: 0 4px; border: 0; outline: 0; background: transparent; color: var(--ct-text); font: inherit; font-size: 15px; }
        .crs-input::placeholder { color: var(--ct-faint); }
        .crs-input::-webkit-search-cancel-button { display: none; }
        .crs-count { min-width: 48px; text-align: center; color: var(--ct-muted); font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .crs-sep { width: 1px; height: 18px; flex: 0 0 1px; background: var(--ct-line); }
        .crs-bar .crs-icon { width: 30px; height: 30px; flex-basis: 30px; }
        .crs-tools { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; padding: 0 16px 10px; }
        .crs-chips { display: flex; gap: 6px; }
        .crs-chips button { height: 32px; padding: 0 14px; border: 1px solid var(--ct-line); border-radius: 999px; background: transparent; color: var(--ct-muted); font: inherit; font-size: 13px; font-weight: 640; white-space: nowrap; cursor: pointer; transition: background-color 160ms, color 160ms, border-color 160ms; }
        .crs-chips button:hover { color: var(--ct-text); }
        .crs-chips button[aria-pressed="true"] { border-color: transparent; background: var(--ct-ink); color: var(--ct-ink-fg); }
        .crs-sort { display: flex; align-items: center; gap: 6px; height: 32px; margin-left: auto; padding: 0 8px; border: 0; border-radius: 8px; background: transparent; color: var(--ct-muted); font: inherit; font-size: 13px; white-space: nowrap; cursor: pointer; }
        .crs-sort:hover { background: var(--ct-hover2); color: var(--ct-text); }
        .crs-status { display: flex; flex-direction: column; gap: 8px; flex: 0 0 auto; padding: 0 16px 12px; color: var(--ct-faint); font-size: 12px; line-height: 1.45; }
        .crs-status:empty { display: none; }
        .crs-status.is-error { color: #e5534b; }
        .crs-status-row { display: flex; align-items: center; gap: 8px; min-height: 20px; }
        .crs-status-row > span { flex: 1; min-width: 0; }
        .crs-status-row button { height: 24px; padding: 0 8px; flex: 0 0 auto; border: 0; border-radius: 6px; background: var(--ct-hover2); color: var(--ct-text); font: inherit; font-size: 12px; font-weight: 640; cursor: pointer; }
        .crs-quiet { font-style: normal; color: var(--ct-faint); white-space: nowrap; }
        .crs-progress { height: 4px; border-radius: 999px; background: var(--ct-sunk); overflow: hidden; }
        .crs-progress i { display: block; width: 36%; height: 100%; border-radius: 999px; background: var(--ct-muted); animation: crsSweep 1.2s var(--ct-ease) infinite; }
        @keyframes crsSweep { from { transform: translateX(-100%); } to { transform: translateX(280%); } }
        .crs-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; border-top: 1px solid var(--ct-line); scrollbar-width: thin; }
        .crs-item { border-bottom: 1px solid var(--ct-line); }
        .crs-item.is-current, .crs-item.is-open { background: var(--ct-hover2); }
        .crs-item-head { display: flex; flex-direction: column; gap: 8px; width: 100%; padding: 12px 16px; border: 0; background: transparent; color: var(--ct-text); font: inherit; text-align: left; cursor: pointer; }
        .crs-item-head:focus-visible { outline: 2px solid var(--ct-ink); outline-offset: -2px; }
        .crs-item-meta { display: flex; align-items: center; gap: 8px; min-height: 20px; }
        .crs-chip { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 6px; background: var(--ct-sunk); color: var(--ct-muted); font-size: 12px; font-weight: 640; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .crs-item.is-current .crs-chip, .crs-item.is-open .crs-chip { background: var(--ct-ink); color: var(--ct-ink-fg); }
        .crs-who { color: var(--ct-faint); font-size: 12px; }
        .crs-chev { display: grid; margin-left: auto; color: var(--ct-faint); }
        .crs-snippet { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--ct-text); font-size: 14px; line-height: 1.55; word-break: keep-all; overflow-wrap: anywhere; }
        .crs-body { display: flex; flex-direction: column; gap: 8px; padding: 0 16px 14px; font-size: 14px; line-height: 1.6; animation: crsOpen 200ms var(--ct-ease); }
        .crs-body p { margin: 0; white-space: pre-wrap; word-break: keep-all; overflow-wrap: anywhere; }
        @keyframes crsOpen { from { opacity: 0; transform: translateY(-3px); } }
        #crack-room-search mark { padding: 0 1px; border-radius: 2px; background: #ffe066; color: #111; }
        #crack-room-search .crs-item.is-open .crs-body mark { background: #ff922b; }
        .crs-actions { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
        .crs-goto { height: 32px; padding: 0 12px; flex: 0 0 auto; border: 0; border-radius: 8px; background: var(--ct-ink); color: var(--ct-ink-fg); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
        .crs-goto-hint { min-width: 0; color: var(--ct-faint); font-size: 12px; }
        .crs-more { width: 100%; height: 44px; border: 0; background: transparent; color: var(--ct-muted); font: inherit; font-size: 13px; cursor: pointer; }
        .crs-more:hover { color: var(--ct-text); }
        .crs-empty { padding: 28px 16px; color: var(--ct-faint); font-size: 13px; line-height: 1.5; text-align: center; }
        .crs-foot { flex: 0 0 auto; padding: 6px 8px; border-top: 1px solid var(--ct-line); }
        .crs-other { display: flex; align-items: center; gap: 10px; width: 100%; height: 40px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: var(--ct-text); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
        .crs-other:hover { background: var(--ct-hover2); }
        .crs-other > svg { color: var(--ct-muted); flex: 0 0 auto; }
        .crs-other-text { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .crs-listtoggle { display: none; }
        #crack-room-search.is-mobile .crs-head { height: 48px; padding: 0 4px 0 14px; }
        #crack-room-search.is-mobile .crs-icon { width: 40px; height: 40px; flex-basis: 40px; }
        #crack-room-search.is-mobile .crs-bar { height: 48px; margin: 0 14px 10px; }
        #crack-room-search.is-mobile .crs-input { font-size: 16px; }
        #crack-room-search.is-mobile .crs-tools { padding: 0 14px 10px; }
        #crack-room-search.is-mobile .crs-chips button { height: 36px; }
        #crack-room-search.is-mobile .crs-status { padding: 0 14px 10px; }
        #crack-room-search.is-mobile .crs-foot { display: none; }
        #crack-room-search.is-mobile:not(.is-list) .crs-tools,
        #crack-room-search.is-mobile:not(.is-list) .crs-status,
        #crack-room-search.is-mobile:not(.is-list) .crs-list { display: none; }
        #crack-room-search.is-mobile.is-list .crs-list { margin-bottom: 10px; }
        #crack-room-search.is-mobile .crs-listtoggle { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; height: 44px; margin: 0 14px; padding: 0 12px; border: 1px solid var(--ct-line); border-radius: 10px; background: transparent; color: var(--ct-text); font: inherit; font-size: 14px; font-weight: 640; cursor: pointer; }
        .crs-listtoggle > svg { color: var(--ct-muted); transition: transform 260ms var(--ct-ease); }
        #crack-room-search.is-list .crs-listtoggle > svg { transform: rotate(180deg); }
        .crs-lt-label { flex: 1; text-align: left; }
        .crs-lt-meta { color: var(--ct-faint); font-size: 12px; font-weight: 500; white-space: nowrap; }
        [data-crs-push] { padding-right: calc(var(--crs-pad0, 0px) + var(--crs-push, 0px)) !important; transition: padding-right 260ms var(--ct-ease); }
        #crack-room-search-backdrop { position: fixed; inset: 0; z-index: 9984; background: rgba(0, 0, 0, .45); opacity: 0; pointer-events: none; transition: opacity 200ms; }
        #crack-room-search-backdrop.is-on { opacity: 1; pointer-events: auto; }
        body[data-theme="light"] #crack-room-search-backdrop { background: rgba(20, 20, 19, .3); }
        #crack-room-search-launcher { position: relative; display: inline-grid; place-items: center; padding: 0; border-radius: 50%; cursor: pointer; transition: background-color 120ms, transform 120ms; }
        #crack-room-search-launcher.crs-in-toolbar { flex: 0 0 auto; }
        #crack-room-search-launcher:not(.crs-in-toolbar) { flex: 0 0 28px; align-self: center; width: 28px; height: 28px; margin: 0 8px 0 auto; }
        #crack-room-search-launcher:not(.crs-in-toolbar):hover { transform: translateY(-1px); }
        #crack-room-search-launcher[aria-pressed="true"] { background: var(--ct-hover2); }
        #crack-room-search-launcher:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 2px; }
        #crack-room-search-launcher.crs-launcher-fallback { position: fixed; z-index: 9983; left: auto; top: auto; right: 20px; bottom: 24px; width: 40px; height: 40px; margin: 0; }
        body { --crs-star: #ffb938; }
        body[data-theme="light"] { --crs-star: #d68b00; }
        .crs-tabs { position: relative; display: grid; grid-template-columns: 1fr 1fr; flex: 0 0 auto; margin: 0 16px 12px; padding: 3px; border-radius: 10px; background: var(--ct-sunk); isolation: isolate; }
        .crs-tabs > i { position: absolute; z-index: -1; top: 3px; bottom: 3px; left: 3px; width: calc((100% - 6px) / 2); border-radius: 8px; background: var(--ct-knob); box-shadow: 0 1px 3px rgba(0, 0, 0, .14), 0 0 0 1px var(--ct-line); transform: translateX(calc(100% * var(--i, 0))); transition: transform 300ms var(--ct-ease); }
        .crs-tabs button { display: flex; align-items: center; justify-content: center; gap: 6px; height: 30px; padding: 0; border: 0; background: transparent; color: var(--ct-muted); font: inherit; font-size: 13px; font-weight: 640; cursor: pointer; transition: color 180ms; }
        .crs-tabs button[aria-selected="true"] { color: var(--ct-text); }
        .crs-tabs button[data-tab="bm"][aria-selected="true"] .crs-star { color: var(--crs-star); }
        .crs-tabs button[data-tab="bm"][aria-selected="true"] .crs-star path { fill: currentColor; }
        .crs-tab-count { color: var(--ct-faint); font-size: 12px; font-variant-numeric: tabular-nums; }
        #crack-room-search[data-tab="bm"] .crs-bar,
        #crack-room-search[data-tab="bm"] .crs-tools,
        #crack-room-search[data-tab="bm"] .crs-status:not(.is-jump),
        #crack-room-search[data-tab="bm"] .crs-list,
        #crack-room-search[data-tab="bm"] .crs-foot { display: none; }
        #crack-room-search:not([data-tab="bm"]) .crs-bm-tools,
        #crack-room-search:not([data-tab="bm"]) .crs-bm-list { display: none; }
        #crack-room-search.is-mobile:not(.is-list) .crs-tabs,
        #crack-room-search.is-mobile:not(.is-list) .crs-bm-tools,
        #crack-room-search.is-mobile:not(.is-list) .crs-bm-list { display: none; }
        .crs-bm-tools { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; padding: 0 16px 12px; }
        .crs-bm-count { flex: 1; min-width: 0; color: var(--ct-faint); font-size: 12px; }
        .crs-bm-sort { height: 32px; padding: 0 8px; border: 1px solid var(--ct-line); border-radius: 8px; background: var(--ct-field); color: var(--ct-muted); font: inherit; font-size: 13px; cursor: pointer; }
        .crs-bm-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; border-top: 1px solid var(--ct-line); scrollbar-width: thin; }
        .crs-bm-item { border-bottom: 1px solid var(--ct-line); }
        .crs-bm-item.is-open { background: var(--ct-hover2); }
        .crs-bm-head { display: flex; flex-direction: column; gap: 8px; width: 100%; padding: 12px 16px; border: 0; background: transparent; color: var(--ct-text); font: inherit; text-align: left; cursor: pointer; }
        .crs-bm-head:focus-visible { outline: 2px solid var(--ct-ink); outline-offset: -2px; }
        .crs-bm-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .crs-bm-title > .crs-star { flex: 0 0 auto; color: var(--crs-star); }
        .crs-bm-name { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 14px; font-weight: 700; }
        .crs-bm-preview { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--ct-muted); font-size: 13.5px; line-height: 1.55; word-break: keep-all; overflow-wrap: anywhere; }
        .crs-bm-item.is-open .crs-bm-preview { -webkit-line-clamp: 4; }
        .crs-bm-memo { display: flex; align-items: flex-start; gap: 6px; color: var(--ct-faint); font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
        .crs-bm-memo > svg { flex: 0 0 auto; margin-top: 2px; }
        .crs-bm-body { display: flex; flex-direction: column; gap: 10px; padding: 0 16px 14px; animation: crsOpen 200ms var(--ct-ease); }
        .crs-bm-actions { display: flex; align-items: center; gap: 8px; }
        .crs-bm-del { margin-left: auto; }
        .crs-btn { height: 32px; padding: 0 12px; flex: 0 0 auto; border: 1px solid var(--ct-line); border-radius: 8px; background: transparent; color: var(--ct-text); font: inherit; font-size: 13px; font-weight: 500; white-space: nowrap; cursor: pointer; }
        .crs-btn:hover { background: var(--ct-hover2); }
        .crs-btn.is-primary { border-color: transparent; background: var(--ct-ink); color: var(--ct-ink-fg); font-weight: 700; }
        .crs-edit { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px 14px; }
        .crs-edit-field { display: flex; flex-direction: column; gap: 6px; }
        .crs-edit-field > span { color: var(--ct-muted); font-size: 12px; font-weight: 640; }
        .crs-edit-title, .crs-edit-memo { width: 100%; padding: 0 12px; border: 1px solid var(--ct-line2); border-radius: 10px; outline: 0; background: var(--ct-field); color: var(--ct-text); font: inherit; font-size: 14px; }
        .crs-edit-title { height: 38px; }
        .crs-edit-memo { padding: 10px 12px; line-height: 1.5; resize: vertical; min-height: 72px; font-size: 13.5px; }
        .crs-edit-title:focus, .crs-edit-memo:focus { border-color: var(--ct-muted); box-shadow: 0 0 0 3px var(--ct-ring); }
        .crs-edit-hint { margin-left: auto; color: var(--ct-faint); font-size: 12px; white-space: nowrap; }
        .crs-notice { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; background: var(--ct-sunk); color: var(--ct-muted); font-size: 12.5px; line-height: 1.45; }
        .crs-notice > span { flex: 1; min-width: 0; }
        .crs-meta-star { display: inline-grid; color: var(--crs-star); }
        #crack-room-search[data-tab="bm"] .crs-status.is-jump { display: flex; }
        .crs-menu-bm .crs-menu-star { color: var(--crs-star); }
        .crs-bm-mark { display: inline-grid; place-items: center; flex: none; width: 28px; height: 28px; margin: 0; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--crs-star); cursor: pointer; -webkit-tap-highlight-color: transparent; }
        .crs-bm-mark:hover { background: rgba(128, 128, 128, .14); }
        .crs-bm-mark:focus-visible { outline: 2px solid var(--crs-star); outline-offset: 1px; }
        .crs-bm-mark.is-corner { position: absolute; top: 0; right: 0; }
        #crack-room-search-flash { position: fixed; z-index: 9982; border: 2px solid #ff922b; border-radius: 14px; box-shadow: 0 0 0 6px rgba(255, 146, 43, .16); pointer-events: none; opacity: 1; transition: opacity 700ms ease; }
        #crack-room-search-flash.is-fading { opacity: 0; }
        #crack-room-search-toast { position: fixed; left: 50%; bottom: max(24px, env(safe-area-inset-bottom, 0px)); z-index: 2147483002; display: flex; align-items: center; gap: 12px; max-width: calc(100vw - 32px); height: 44px; padding: 0 8px 0 16px; box-sizing: border-box; border-radius: 12px; background: var(--ct-ink); color: var(--ct-ink-fg); box-shadow: var(--ct-shadow); font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Segoe UI", sans-serif; font-size: 13.5px; font-weight: 640; opacity: 0; pointer-events: none; transform: translate(-50%, 8px); transition: opacity 160ms, transform 220ms var(--ct-ease); }
        #crack-room-search-toast.is-on { opacity: 1; pointer-events: auto; transform: translate(-50%, 0); }
        #crack-room-search-toast .crs-toast-icon { display: grid; color: var(--crs-star); }
        #crack-room-search-toast .crs-toast-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        #crack-room-search-toast button { height: 30px; padding: 0 10px; flex: 0 0 auto; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 13px; font-weight: 700; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
        @media (max-width: 900px) { #crack-room-search-toast { bottom: calc(132px + env(safe-area-inset-bottom, 0px)); } }
        #crack-room-search.is-mobile .crs-tabs { margin: 0 14px 10px; }
        #crack-room-search.is-mobile .crs-tabs button { height: 36px; }
        #crack-room-search.is-mobile .crs-bm-tools { padding: 0 14px 10px; }
        #crack-room-search.is-mobile .crs-bm-sort { height: 36px; }
        #crack-room-search.is-mobile.is-list .crs-bm-list { margin-bottom: 10px; }
        #crack-room-search.is-mobile .crs-bm-head { padding: 12px 14px; }
        #crack-room-search.is-mobile .crs-bm-body, #crack-room-search.is-mobile .crs-edit { padding-left: 14px; padding-right: 14px; }
        #crack-room-search.is-mobile .crs-btn { height: 40px; }
        #crack-room-search.is-mobile .crs-edit-title { height: 44px; font-size: 16px; }
        #crack-room-search.is-mobile .crs-edit-memo { font-size: 16px; }
        @media (prefers-reduced-motion: reduce) { #crack-room-search-flash, #crack-room-search-toast { transition: none !important; } }
        ::highlight(crack-story-search-loader-all) { background-color: #ffe066; color: #111; }
        ::highlight(crack-story-search-loader-current) { background-color: #ff922b; color: #111; text-decoration: underline 2px #111; }
        @media (pointer: coarse) { .crs-item-head { padding: 14px 16px; } .crs-goto { height: 40px; } }
        @media (prefers-reduced-motion: reduce) {
            #crack-room-search, #crack-room-search *, #crack-room-search-backdrop, #crack-room-search-launcher { animation: none !important; transition: none !important; }
        }
    `);

    // ═══════════════════ 형광펜 (1.7.0): 크랙 형광펜 노트 1.3.0.1을 튜너로 합침 ═══════════════════
    // 기록은 IndexedDB `crack-tuner-highlights`에 둔다(거의 찬 크랙 localStorage와 따로).
    // 옛 기록(localStorage `Highlighter_<방 경로>`)은 「옮기기」를 눌러야 복사하고, 「원래 칸 비우기」를 따로 눌러야 지운다.
    const HP_DB_NAME = 'crack-tuner-highlights';
    const HP_LEGACY_PREFIX = 'Highlighter_';
    const HP_DEFAULT_PALETTE = [{ bg: '#ffe066', text: '' }, { bg: '#8ce99a', text: '#00470d' }, { bg: '#74c0fc', text: '' }];
    const HP_MAX_COLORS = 8;
    const HP_UI = '#crk-hp-pill, #crk-hp-edit, #crk-hp-pop, #crk-hp-migrate, #crk-hp-toast, #crk-hp-lounge, #crk-hp-export, #crack-room-search, #crack-lounge';
    const hp = {
        db: null, dbPromise: null, ready: false, readyWaiters: [], loadError: null,
        settings: { palette: HP_DEFAULT_PALETTE.map(c => ({ ...c })), opacity: 0.4, bold: true, marks: false, lsort: 'room', names: {}, migrated: 0 },
        all: [], byId: new Map(), version: 0,
        paintTimer: 0, paintSig: '', sel: null, selTimer: 0, editId: '', editArmed: false, toastTimer: 0,
        legacyChecked: false, oldWarned: false, matchBusy: false, matchDone: new Set(),
        listeners: new Set(), observer: null, legacyIds: new Set()
    };

    function hpIsMobile() {
        try { return matchMedia('(max-width: 900px), (pointer: coarse)').matches; } catch (e) { return false; }
    }

    // ── 저장소 ──
    function hpOpenDb() {
        if (hp.dbPromise) return hp.dbPromise;
        hp.dbPromise = new Promise((resolve, reject) => {
            let req;
            try { req = indexedDB.open(HP_DB_NAME, 1); } catch (e) { reject(e); return; }
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('hl')) db.createObjectStore('hl', { keyPath: 'id' }).createIndex('chatId', 'chatId');
                if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
            };
            req.onsuccess = () => {
                const db = req.result;
                db.onversionchange = () => { db.close(); hp.db = null; hp.dbPromise = null; };
                hp.db = db;
                resolve(db);
            };
            req.onerror = () => reject(req.error);
        });
        hp.dbPromise.catch(() => { hp.dbPromise = null; });
        return hp.dbPromise;
    }

    function hpTx(store, mode, fn) {
        return hpOpenDb().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(store, mode);
            let req;
            try { req = fn(tx.objectStore(store)); } catch (e) { reject(e); return; }
            tx.oncomplete = () => resolve(req && typeof req === 'object' && 'result' in req ? req.result : req);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        }));
    }

    async function hpLoad() {
        try {
            const [rows, meta, legacyMeta] = await Promise.all([
                hpTx('hl', 'readonly', st => st.getAll()),
                hpTx('meta', 'readonly', st => st.get('settings')),
                hpTx('meta', 'readonly', st => st.get('legacy'))
            ]);
            hp.all = Array.isArray(rows) ? rows : [];
            hp.byId = new Map(hp.all.map(r => [r.id, r]));
            if (Array.isArray(legacyMeta?.ids)) hp.legacyIds = new Set(legacyMeta.ids);
            if (meta && meta.v && typeof meta.v === 'object') Object.assign(hp.settings, meta.v);
            if (!Array.isArray(hp.settings.palette) || !hp.settings.palette.length) hp.settings.palette = HP_DEFAULT_PALETTE.map(c => ({ ...c }));
        } catch (e) {
            hp.loadError = e;
        }
        hp.ready = true;
        hpApplyVars();
        hp.readyWaiters.splice(0).forEach(fn => { try { fn(); } catch (e) {} });
        hpEmit();
        hpSchedulePaint(0);
        hpRememberTitles();
        setTimeout(hpCheckLegacy, 1200);
    }

    function hpWhenReady(fn) { if (hp.ready) fn(); else hp.readyWaiters.push(fn); }

    function hpEmit() {
        hp.version++;
        hp.listeners.forEach(fn => { try { fn(); } catch (e) {} });
    }

    function hpPut(rec) {
        return hpPutMany([rec]).catch(() => {});
    }

    // 메모리를 먼저 바꿔 바로 보이게 하고, 저장이 실패하면 메모리도 되돌린다(메모리만 믿고 옛 칸을 비우지 않게).
    function hpPutMany(recs) {
        const prev = recs.map(r => hp.byId.get(r.id));
        for (const rec of recs) hp.byId.set(rec.id, rec);
        hp.all = [...hp.byId.values()];
        hpEmit();
        return hpTx('hl', 'readwrite', st => { let last; for (const rec of recs) last = st.put(rec); return last; }).catch(err => {
            recs.forEach((rec, i) => { if (prev[i]) hp.byId.set(rec.id, prev[i]); else hp.byId.delete(rec.id); });
            hp.all = [...hp.byId.values()];
            hpEmit();
            hpToast('형광펜을 저장하지 못했어요');
            throw err;
        });
    }

    function hpRemove(id) {
        const rec = hp.byId.get(id);
        if (!rec) return Promise.resolve();
        hp.byId.delete(id);
        hp.all = [...hp.byId.values()];
        hpUnpaint(id);
        hpEmit();
        return hpTx('hl', 'readwrite', st => st.delete(id)).catch(() => {
            hp.byId.set(id, rec);
            hp.all = [...hp.byId.values()];
            hp.paintSig = '';
            hpEmit();
            hpSchedulePaint(0);
            hpToast('지우지 못했어요');
        });
    }

    function hpSaveSettings({ emit = true } = {}) {
        hpApplyVars();
        hpRestyleAll();
        if (emit) hpEmit();
        return hpTx('meta', 'readwrite', st => st.put({ k: 'settings', v: hp.settings })).catch(() => {});
    }
    function hpSaveLegacyIds() {
        return hpTx('meta', 'readwrite', st => st.put({ k: 'legacy', ids: [...hp.legacyIds] }));
    }

    function hpRoomRecs(chatId) {
        return hp.all.filter(r => r.chatId === chatId);
    }

    // ── 색 ──
    function hpColor(value, fallback = '#ffe066') {
        const s = String(value || '').trim();
        return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) ? s : fallback;
    }
    function hpRgba(hex, alpha) {
        let h = hpColor(hex).slice(1);
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        const n = parseInt(h.slice(0, 6), 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    }
    function hpSwatch(color) {
        return color && color.text ? `linear-gradient(135deg, ${hpColor(color.bg)} 50%, ${hpColor(color.text, '#333333')} 50%)` : hpColor(color && color.bg);
    }
    function hpSameColor(a, b) {
        return !!a && !!b && String(a.bg).toLowerCase() === String(b.bg).toLowerCase() && String(a.text || '').toLowerCase() === String(b.text || '').toLowerCase();
    }
    function hpApplyVars() {
        document.documentElement.style.setProperty('--crk-hp-weight', hp.settings.bold ? '700' : 'inherit');
    }

    // ── 글에 칠하기 ──
    function hpMarkStyle(mark, rec) {
        mark.style.backgroundColor = hpRgba(rec.color?.bg || '#ffe066', hp.settings.opacity);
        mark.style.color = rec.color?.text ? hpColor(rec.color.text, 'inherit') : 'inherit';
    }
    function hpRestyleAll() {
        document.querySelectorAll('mark.crk-hl').forEach(mark => {
            const rec = hp.byId.get(mark.dataset.hp);
            if (rec) hpMarkStyle(mark, rec);
        });
    }
    function hpUnpaint(id) {
        document.querySelectorAll(`mark.crk-hl[data-hp="${CSS.escape(id)}"]`).forEach(mark => {
            mark.replaceWith(document.createTextNode(mark.textContent));
        });
    }
    function hpIsGenerating() {
        return !!document.querySelector('button[aria-label="생성 중지"]');
    }
    function hpMarkdowns() {
        return [...document.querySelectorAll('.wrtn-markdown')].filter(md => !md.closest(HP_UI) && !md.closest('[contenteditable="true"], .ProseMirror, textarea'));
    }
    function hpSchedulePaint(delay = 380) {
        if (hp.paintTimer) return;
        hp.paintTimer = setTimeout(() => {
            const run = () => { hp.paintTimer = 0; hpPaint(); };
            if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 900 }); else run();
        }, delay);
    }
    function hpPaint(force = false) {
        const chatId = rsChatIdFromPath();
        if (!chatId || !hp.ready) return;
        const recs = hpRoomRecs(chatId);
        if (!recs.length) { hp.paintSig = ''; return; }
        // 답을 쓰는 중에는 크랙이 글을 계속 바꾸므로 끝난 뒤에 칠한다.
        if (hpIsGenerating()) { setTimeout(() => hpSchedulePaint(0), 1500); return; }
        const mds = hpMarkdowns();
        const edge = mds.length ? `${mds[0].textContent.length},${mds[mds.length - 1].textContent.length}` : '';
        const sig = `${chatId}|${hp.version}|${mds.length}|${edge}`;
        if (!force && sig === hp.paintSig) return;
        for (const md of mds) hpPaintIn(md, recs);
        hp.paintSig = `${chatId}|${hp.version}|${mds.length}|${mds.length ? `${mds[0].textContent.length},${mds[mds.length - 1].textContent.length}` : ''}`;
    }
    function hpTextMap(md) {
        const walker = document.createTreeWalker(md, NodeFilter.SHOW_TEXT);
        const map = [];
        let text = '';
        let node;
        while ((node = walker.nextNode())) {
            const parent = node.parentNode;
            if (!parent || /^(SCRIPT|STYLE|TEXTAREA|INPUT|NOSCRIPT|BUTTON)$/.test(parent.nodeName)) continue;
            const clean = node.nodeValue.replace(/\s+/g, '');
            const blockish = n => !!n && n.nodeType === 1 && /^(P|DIV|UL|OL|LI|BLOCKQUOTE|PRE|H[1-6]|TABLE|TBODY|TR|HR|BR|SECTION)$/.test(n.nodeName);
            const gap = clean.length === 0 && (blockish(node.previousSibling) || blockish(node.nextSibling) || /^(UL|OL|TABLE|TBODY|TR)$/.test(parent.nodeName));
            map.push({ node, start: text.length, end: text.length + clean.length, orig: node.nodeValue, spaceOnly: clean.length === 0, gap });
            text += clean;
        }
        return { map, text };
    }
    function hpOrigIndex(cleanIdx, orig, isEnd) {
        const target = isEnd ? cleanIdx - 1 : cleanIdx;
        let count = 0;
        for (let i = 0; i < orig.length; i++) {
            if (!/\s/.test(orig[i])) {
                if (count === target) return isEnd ? i + 1 : i;
                count++;
            }
        }
        return orig.length;
    }
    function hpPaintIn(md, recs) {
        let tm = null;
        for (const rec of recs) {
            if (md.querySelector(`mark.crk-hl[data-hp="${CSS.escape(rec.id)}"]`)) continue;
            const target = String(rec.text || '').replace(/\s+/g, '');
            if (!target) continue;
            if (!tm) tm = hpTextMap(md);
            const hits = [];
            for (let i = tm.text.indexOf(target); i !== -1; i = tm.text.indexOf(target, i + target.length)) hits.push(i);
            if (!hits.length) continue;
            for (const hit of hits.reverse()) {
                const end = hit + target.length;
                const parts = tm.map.filter(m => (m.spaceOnly ? m.start > hit && m.start < end : m.end > hit && m.start < end));
                parts.reverse().forEach((m, idx, arr) => {
                    let s = 0, e = m.orig.length;
                    if (!m.spaceOnly) {
                        s = hit < m.start ? 0 : hpOrigIndex(hit - m.start, m.orig, false);
                        e = end > m.end ? m.orig.length : hpOrigIndex(end - m.start, m.orig, true);
                    }
                    if (m.gap || s >= e || !m.node.parentNode || e > m.node.nodeValue.length) return;
                    const mark = document.createElement('mark');
                    mark.className = 'crk-hl';
                    if (idx === arr.length - 1) mark.classList.add('crk-hl-s');
                    if (idx === 0) mark.classList.add('crk-hl-e');
                    mark.dataset.hp = rec.id;
                    mark.textContent = m.node.nodeValue.substring(s, e);
                    hpMarkStyle(mark, rec);
                    const rest = m.node.splitText(s);
                    rest.nodeValue = rest.nodeValue.substring(e - s);
                    rest.parentNode.insertBefore(mark, rest);
                });
            }
            tm = null; // 감싼 뒤에는 글 지도를 새로 만든다.
        }
    }

    // ── 고르기 → 색 알약 ──
    function hpSelectionInfo() {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
        const range = sel.getRangeAt(0);
        const anc = range.commonAncestorContainer;
        const el = anc.nodeType === 1 ? anc : anc.parentElement;
        if (!el || el.closest(HP_UI) || el.closest('[contenteditable="true"], .ProseMirror, textarea, .__chat_input_textarea')) return null;
        const chatId = rsChatIdFromPath();
        if (!chatId) return null;
        // 고른 범위가 걸친 메시지 글 상자마다 한 조각씩(여러 문단은 한 조각, 여러 메시지는 메시지마다).
        const inside = el.closest('.wrtn-markdown');
        const mds = inside ? [inside] : [...el.querySelectorAll('.wrtn-markdown')].filter(md => range.intersectsNode(md) && !md.closest(HP_UI));
        const parts = [];
        for (const md of mds) {
            const r = range.cloneRange();
            if (!md.contains(range.startContainer)) r.setStart(md, 0);
            if (!md.contains(range.endContainer)) r.setEnd(md, md.childNodes.length);
            const text = hpRangeText(r);
            if (!text) continue;
            const group = md.closest('[data-message-group-id]');
            parts.push({ text, messageId: group ? group.getAttribute('data-message-group-id') || '' : '' });
        }
        if (!parts.length) return null;
        return { parts, text: parts[0].text, chatId, messageId: parts[0].messageId, range: range.cloneRange() };
    }
    // 고른 글을 문단 사이 줄바꿈을 살려 꺼낸다.
    function hpRangeText(range) {
        const box = document.createElement('div');
        box.append(range.cloneContents());
        box.querySelectorAll('button, .crs-bm-mark').forEach(n => n.remove());
        box.querySelectorAll('br').forEach(n => n.replaceWith('\n'));
        box.querySelectorAll('p, li, div, blockquote, h1, h2, h3, h4, h5, h6, pre, tr').forEach(n => n.append('\n'));
        return box.textContent.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean).join('\n');
    }
    function hpPillEl() {
        let pill = document.getElementById('crk-hp-pill');
        if (pill) return pill;
        pill = ctEl('div', 'crk-hp-pill');
        pill.id = 'crk-hp-pill';
        pill.setAttribute('role', 'toolbar');
        pill.setAttribute('aria-label', '형광펜 칠하기');
        pill.addEventListener('pointerdown', e => { if (!e.target.closest('input')) e.preventDefault(); });
        pill.addEventListener('mousedown', e => { if (!e.target.closest('input')) e.preventDefault(); });
        pill.addEventListener('click', hpOnPillClick);
        document.body.appendChild(pill);
        return pill;
    }
    function hpDots(cur) {
        return hp.settings.palette.map((c, i) => `<button type="button" class="crk-hp-dot${cur && hpSameColor(cur, c) ? ' is-on' : ''}" data-hp-c="${i}" style="--n:${i};background:${hpSwatch(c)}" aria-label="${i + 1}번 색"></button>`).join('');
    }
    function hpShowPill() {
        const info = hp.sel;
        if (!info) return;
        const pill = hpPillEl();
        const mobile = hpIsMobile();
        pill.className = `crk-hp-pill${mobile ? ' is-dock' : ''}`;
        pill.innerHTML = `${hpDots(null)}<i class="crk-hp-vs"></i><button type="button" class="crk-hp-ib" data-hp-act="memo" title="칠하고 메모" aria-label="칠하고 메모">${HP_IC.pen}</button>${mobile ? `<button type="button" class="crk-hp-ib" data-hp-act="close" aria-label="닫기">${HP_IC.x}</button>` : ''}`;
        pill.style.display = 'flex';
        if (mobile) {
            const composer = document.querySelector('.__chat_input_textarea')?.closest('form, .flex.w-full.flex-col.rounded-lg');
            const top = composer ? composer.getBoundingClientRect().top : innerHeight - 120;
            pill.style.left = '10px';
            pill.style.right = '10px';
            pill.style.top = '';
            pill.style.bottom = `${Math.max(12, innerHeight - top + 8)}px`;
        } else {
            const rects = [...info.range.getClientRects()].filter(r => r.width > 1);
            const last = rects[rects.length - 1] || info.range.getBoundingClientRect();
            pill.style.right = '';
            pill.style.bottom = '';
            const w = pill.offsetWidth || 200;
            const h = pill.offsetHeight || 40;
            // 원래 형광펜처럼 손을 뗀 커서 바로 옆에 띄운다.
            const pt = hp.lastPt || { x: last.right, y: last.bottom };
            const left = Math.max(8, Math.min(pt.x + 12, innerWidth - w - 8));
            const top = pt.y + 12 + h > innerHeight - 8 ? Math.max(8, pt.y - h - 12) : pt.y + 12;
            pill.style.left = `${left}px`;
            pill.style.top = `${top}px`;
            const r0 = info.range.getBoundingClientRect();
            hp.pillAt = { left, top, rx: r0.left, ry: r0.top };
        }
        pill.classList.remove('is-in');
        void pill.offsetWidth;
        pill.classList.add('is-in');
    }
    function hpHidePill() {
        const pill = document.getElementById('crk-hp-pill');
        if (pill) pill.style.display = 'none';
        hp.sel = null;
    }
    function hpOnPillClick(event) {
        const dot = event.target.closest('[data-hp-c]');
        const act = event.target.closest('[data-hp-act]')?.dataset.hpAct;
        if (dot) { hpAdd(hp.settings.palette[+dot.dataset.hpC]); return; }
        if (act === 'memo') { hpAdd(hp.settings.palette[0], { memo: true }); return; }
        if (act === 'close') { window.getSelection()?.removeAllRanges(); hpHidePill(); }
    }
    function hpCheckSelection() {
        hp.selTimer = 0;
        const info = hpSelectionInfo();
        if (!info) { if (!document.getElementById('crk-hp-pill')?.matches(':hover')) hpHidePill(); return; }
        hp.sel = info;
        hpShowPill();
    }
    function hpOnPointerUp(event) {
        if (event.button > 0) return;
        if (event.target.closest?.(HP_UI)) return;
        const pt = event.changedTouches?.[0] || event;
        hp.lastPt = Number.isFinite(pt.clientX) ? { x: pt.clientX, y: pt.clientY } : null;
        clearTimeout(hp.selTimer);
        hp.selTimer = setTimeout(hpCheckSelection, 60);
    }
    // 스크롤 신호는 다른 확프 목록 · 숨은 칸에서도 온다. 그것만으로는 닫지 않고,
    // 고른 글 · 칠한 곳이 실제로 움직였을 때만 알약은 따라가고 고치기 알약은 닫는다.
    function hpOnScrollFrame() {
        hp.scrollRaf = 0;
        const pill = document.getElementById('crk-hp-pill');
        if (hp.sel && hp.pillAt && pill?.style.display === 'flex' && !hpIsMobile()) {
            const sel = window.getSelection();
            const r = hp.sel.range.getBoundingClientRect();
            if (!sel || sel.isCollapsed || (!r.width && !r.height)) hpHidePill();
            else if (Math.abs(r.left - hp.pillAt.rx) >= 1 || Math.abs(r.top - hp.pillAt.ry) >= 1) {
                hp.pillAt = { left: hp.pillAt.left + r.left - hp.pillAt.rx, top: hp.pillAt.top + r.top - hp.pillAt.ry, rx: r.left, ry: r.top };
                pill.style.left = `${hp.pillAt.left}px`;
                pill.style.top = `${hp.pillAt.top}px`;
            }
        }
        if (hp.editId) {
            if (!document.getElementById('crk-hp-edit')?.contains(document.activeElement) && hpEditMarkMoved()) hpCloseEdit();
        } else if (hp.popId) hpClosePop();
    }
    function hpEditMarkMoved() {
        const mark = document.querySelector(`mark.crk-hl[data-hp="${CSS.escape(hp.editId)}"]`);
        if (!mark || !hp.editAt) return true;
        const r = mark.getBoundingClientRect();
        return Math.abs(r.left - hp.editAt.x) >= 1 || Math.abs(r.top - hp.editAt.y) >= 1;
    }
    function hpOnSelectionChange() {
        if (!hpIsMobile()) {
            // PC는 손을 뗄 때 띄운다. 선택이 풀리면 알약도 닫는다.
            const sel = window.getSelection();
            if (hp.sel && (!sel || sel.isCollapsed)) hpHidePill();
            return;
        }
        clearTimeout(hp.selTimer);
        hp.selTimer = setTimeout(hpCheckSelection, 280);
    }
    function hpNewId() {
        return 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }
    function hpAdd(color, { memo = false } = {}) {
        const s = hp.sel;
        if (!s || !color) return;
        const now = Date.now();
        const recs = (s.parts || [{ text: s.text, messageId: s.messageId }]).map((part, i) => ({
            id: hpNewId(), chatId: s.chatId, path: location.pathname, text: part.text,
            color: { bg: color.bg, text: color.text || '' }, note: '', createdAt: now + i,
            messageId: part.messageId, role: '', turn: 0, who: '', whoAuto: true, storyId: hpStoryIdFromPath(location.pathname)
        }));
        recs.forEach(hpFillFromLog);
        if (recs.some(r => !r.matched)) hp.matchDone.delete(s.chatId);
        const rec = recs[0];
        window.getSelection()?.removeAllRanges();
        hpHidePill();
        hpPutMany(recs).catch(() => {});
        hp.paintSig = '';
        hpPaint(true);
        if (memo) requestAnimationFrame(() => {
            const mark = document.querySelector(`mark.crk-hl[data-hp="${CSS.escape(rec.id)}"]`);
            if (mark) hpOpenEdit(rec.id, mark.getBoundingClientRect(), { memo: true });
        });
    }
    function hpStoryIdFromPath(path) {
        const m = /\/stories\/([^/]+)\//.exec(String(path || ''));
        return m ? m[1] : '';
    }

    // ── 칠한 곳 누르기 → 색 · 메모 · 말한 사람 · 지우기 ──
    function hpEditEl() {
        let el = document.getElementById('crk-hp-edit');
        if (el) return el;
        el = ctEl('div', 'crk-hp-pill crk-hp-edit');
        el.id = 'crk-hp-edit';
        el.setAttribute('role', 'toolbar');
        el.setAttribute('aria-label', '칠한 곳 고치기');
        el.addEventListener('click', hpOnEditClick);
        el.addEventListener('keydown', hpOnEditKey);
        el.addEventListener('keyup', e => e.stopPropagation());
        document.body.appendChild(el);
        return el;
    }
    function hpOpenEdit(id, rect, { memo = false } = {}) {
        const rec = hp.byId.get(id);
        if (!rec) return;
        hp.editId = id;
        hp.editArmed = false;
        const mr = document.querySelector(`mark.crk-hl[data-hp="${CSS.escape(id)}"]`)?.getBoundingClientRect();
        hp.editAt = mr ? { x: mr.left, y: mr.top } : null;
        const el = hpEditEl();
        el.innerHTML = `${hpDots(rec.color)}<i class="crk-hp-vs"></i>`
            + `<button type="button" class="crk-hp-ib" data-hp-act="memo" title="메모" aria-label="메모">${HP_IC.pen}</button>`
            + `<button type="button" class="crk-hp-ib" data-hp-act="who" title="말한 사람" aria-label="말한 사람">${HP_IC.user}</button>`
            + `<button type="button" class="crk-hp-ib crk-hp-del" data-hp-act="del" title="지우기" aria-label="지우기">${HP_IC.trash}</button>`
            + `<div class="crk-hp-memo-row"${memo ? '' : ' hidden'}><input type="text" class="crk-hp-memo" maxlength="300" placeholder="메모" value=""><button type="button" class="crk-hp-ib" data-hp-act="memosave" aria-label="메모 저장">${HP_IC.check}</button></div>`;
        el.querySelector('.crk-hp-memo').value = rec.note || '';
        el.style.display = 'flex';
        el.classList.toggle('has-memo', memo);
        const w = el.offsetWidth || 220;
        el.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - w - 8))}px`;
        const below = rect.bottom + 8;
        el.style.top = `${below + 100 > innerHeight ? Math.max(8, rect.top - (memo ? 96 : 52)) : below}px`;
        el.classList.remove('is-in');
        void el.offsetWidth;
        el.classList.add('is-in');
        if (memo) requestAnimationFrame(() => el.querySelector('.crk-hp-memo')?.focus());
    }
    function hpCloseEdit() {
        const el = document.getElementById('crk-hp-edit');
        if (el) el.style.display = 'none';
        hp.editId = '';
        hp.editArmed = false;
        hpClosePop();
    }
    function hpOnEditClick(event) {
        const rec = hp.byId.get(hp.editId);
        if (!rec) { hpCloseEdit(); return; }
        const el = event.currentTarget;
        const dot = event.target.closest('[data-hp-c]');
        const act = event.target.closest('[data-hp-act]')?.dataset.hpAct;
        if (dot) {
            const c = hp.settings.palette[+dot.dataset.hpC];
            if (!c) return;
            hpPut({ ...rec, color: { bg: c.bg, text: c.text || '' } });
            document.querySelectorAll(`mark.crk-hl[data-hp="${CSS.escape(rec.id)}"]`).forEach(m => hpMarkStyle(m, hp.byId.get(rec.id)));
            el.querySelectorAll('.crk-hp-dot').forEach(b => b.classList.toggle('is-on', b === dot));
            return;
        }
        if (act === 'memo') {
            const row = el.querySelector('.crk-hp-memo-row');
            row.hidden = !row.hidden;
            el.classList.toggle('has-memo', !row.hidden);
            if (!row.hidden) el.querySelector('.crk-hp-memo').focus();
            return;
        }
        if (act === 'memosave') { hpSaveMemo(); return; }
        if (act === 'who') { hpOpenWhoPop(rec.id, event.target.closest('button').getBoundingClientRect()); return; }
        if (act === 'del') {
            // 한 번 누르면 바로 지운다(알림의 되돌리기로 살림).
            hpRemove(rec.id);
            hpCloseEdit();
            hpToast('형광펜을 지웠어요', { undo: rec });
        }
    }
    function hpOnEditKey(event) {
        event.stopPropagation();
        if (event.key === 'Escape') { hpCloseEdit(); return; }
        if (event.key === 'Enter' && event.target.classList?.contains('crk-hp-memo') && !event.isComposing) { event.preventDefault(); hpSaveMemo(); }
    }
    function hpSaveMemo() {
        const rec = hp.byId.get(hp.editId);
        const input = document.querySelector('#crk-hp-edit .crk-hp-memo');
        if (!rec || !input) return;
        hpPut({ ...rec, note: input.value.trim() });
        hpCloseEdit();
        hpToast(input.value.trim() ? '메모를 저장했어요' : '메모를 지웠어요');
    }
    function hpOnDocClick(event) {
        const mark = event.target.closest?.('mark.crk-hl');
        if (mark && !event.target.closest(HP_UI)) {
            if (window.getSelection()?.toString().trim()) return;
            event.preventDefault();
            event.stopPropagation();
            hpHidePill();
            hpOpenEdit(mark.dataset.hp, mark.getBoundingClientRect());
            return;
        }
        if (!event.target.closest?.('#crk-hp-edit, #crk-hp-pop')) hpCloseEdit();
    }
    function hpOnContextMenu(event) {
        const mark = event.target.closest?.('mark.crk-hl');
        if (!mark) return;
        event.preventDefault();
        hpOpenEdit(mark.dataset.hp, mark.getBoundingClientRect());
    }

    // ── 말한 사람 ──
    function hpWhoLabel(rec) {
        if (!rec) return '';
        if (rec.who === 'me') return '나';
        if (rec.who === 'narr') return '서술';
        return rec.who || '';
    }
    // 카드 · 그림에 쓰는 이름: 직접 고친 이름 → 내 메시지면 「나」 → 원래 채팅 제목(작품 이름).
    function hpNameOf(rec) {
        if (!rec) return '';
        if (rec.whoAuto === false && rec.who) return rec.who === 'me' ? '나' : rec.who === 'narr' ? '' : rec.who;
        if (rec.role === 'user') return '나';
        return hpGuessCharName(rec);
    }
    function hpRoomNames(chatId) {
        const names = new Set(hp.settings.names?.[chatId] || []);
        for (const r of hpRoomRecs(chatId)) if (r.who && r.who !== 'me' && r.who !== 'narr') names.add(r.who);
        return [...names].slice(0, 12);
    }
    function hpPopEl() {
        let el = document.getElementById('crk-hp-pop');
        if (el) return el;
        el = ctEl('div', 'crk-hp-pop');
        el.id = 'crk-hp-pop';
        el.addEventListener('click', hpOnPopClick);
        el.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.key === 'Escape') hpClosePop();
            if (event.key === 'Enter' && event.target.classList?.contains('crk-hp-who-in') && !event.isComposing) { event.preventDefault(); hpSetWho(hp.popId, event.target.value.trim(), true); }
        });
        el.addEventListener('keyup', e => e.stopPropagation());
        document.body.appendChild(el);
        return el;
    }
    function hpOpenWhoPop(id, rect) {
        const rec = hp.byId.get(id);
        if (!rec) return;
        hp.popId = id;
        const el = hpPopEl();
        const auto = hpGuessCharName(rec);
        const cur = rec.whoAuto === false ? rec.who : '__auto';
        const opts = [['__auto', rec.role === 'user' ? '나' : (auto || '이름 없이'), '처음대로(원래 채팅 제목)']];
        if (auto) opts.push([auto, auto, '원래 채팅 제목']);
        opts.push(['me', '나', '내 말'], ['narr', '이름 없이', '서술']);
        const extra = hpRoomNames(rec.chatId).filter(n => n !== auto);
        el.innerHTML = `<div class="crk-hp-pop-h">${HP_IC.user}<span>카드에 쓸 이름</span></div>`
            + opts.map(([v, label, sub]) => `<button type="button" class="crk-hp-who${cur === v ? ' is-on' : ''}" data-hp-who="${hpEsc(v)}"><b>${hpEsc(label)}</b><span>${sub}</span>${cur === v ? HP_IC.check : ''}</button>`).join('')
            + (extra.length ? `<div class="crk-hp-pop-h2">이 방에서 쓴 이름</div><div class="crk-hp-chips">${extra.map(n => `<button type="button" class="${cur === n ? 'is-on' : ''}" data-hp-who="${hpEsc(n)}">${hpEsc(n)}</button>`).join('')}</div>` : '')
            + `<label class="crk-hp-who-row">${HP_IC.pen}<input type="text" class="crk-hp-who-in" maxlength="30" placeholder="직접 쓰기"></label>`;
        el.style.display = 'block';
        const w = el.offsetWidth || 240;
        el.style.left = `${Math.max(8, Math.min(rect.left - 10, innerWidth - w - 8))}px`;
        const h = el.offsetHeight || 240;
        el.style.top = `${rect.bottom + 6 + h > innerHeight ? Math.max(8, rect.top - h - 6) : rect.bottom + 6}px`;
        el.classList.remove('is-in');
        void el.offsetWidth;
        el.classList.add('is-in');
    }
    function hpClosePop() {
        const el = document.getElementById('crk-hp-pop');
        if (el) el.style.display = 'none';
        hp.popId = '';
    }
    function hpOnPopClick(event) {
        const btn = event.target.closest('[data-hp-who]');
        if (btn) hpSetWho(hp.popId, btn.dataset.hpWho, false);
    }
    function hpSetWho(id, who, typed) {
        const rec = hp.byId.get(id);
        if (!rec || !who) return;
        if (who === '__auto') {
            hpPut({ ...rec, who: '', whoAuto: true });
            hpClosePop();
            hpToast(`이름: ${hpNameOf({ ...rec, who: '', whoAuto: true }) || '없음'} (처음대로)`);
            return;
        }
        hpPut({ ...rec, who, whoAuto: false });
        if (typed && who !== 'me' && who !== 'narr') {
            const list = new Set(hp.settings.names?.[rec.chatId] || []);
            list.add(who);
            hp.settings.names = { ...(hp.settings.names || {}), [rec.chatId]: [...list].slice(-12) };
            hpSaveSettings();
        }
        hpClosePop();
        hpToast(`이름: ${who === 'me' ? '나' : who === 'narr' ? '없음' : who}`);
    }
    function hpEsc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // ── 알림 ──
    function hpToast(text, { undo = null, action = null } = {}) {
        let el = document.getElementById('crk-hp-toast');
        if (!el) {
            el = ctEl('div');
            el.id = 'crk-hp-toast';
            el.setAttribute('role', 'status');
            document.body.appendChild(el);
        }
        el.replaceChildren(ctEl('span', 'crk-hp-toast-text', text));
        if (undo) {
            const b = ctEl('button', '', '되돌리기');
            b.type = 'button';
            b.addEventListener('click', () => { hpPut(undo); hp.paintSig = ''; hpPaint(true); el.classList.remove('is-on'); });
            el.append(b);
        } else if (action) {
            const b = ctEl('button', '', action.label);
            b.type = 'button';
            b.addEventListener('click', () => { el.classList.remove('is-on'); action.run(); });
            el.append(b);
        }
        el.classList.add('is-on');
        clearTimeout(hp.toastTimer);
        hp.toastTimer = setTimeout(() => el.classList.remove('is-on'), undo || action ? 5200 : 2400);
    }

    const HP_IC = {
        hl: ctSvg('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>', 15),
        pen: ctSvg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>', 15),
        user: ctSvg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', 15),
        trash: ctSvg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 15),
        x: ctSvg('<path d="M18 6 6 18M6 6l12 12"/>', 15),
        check: ctSvg('<path d="M20 6 9 17l-5-5"/>', 14),
        go: ctSvg('<path d="M7 17 17 7M8 7h9v9"/>', 15),
        share: ctSvg('<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4M12 2v13"/>', 15),
        more: ctSvg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>', 15),
        gear: ctSvg('<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>', 16),
        info: ctSvg('<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>', 16),
        clock: ctSvg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 16),
        layers: ctSvg('<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>', 16),
        expand: ctSvg('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>', 16),
        search: ctSvg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 16),
        file: ctSvg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>', 16),
        checksq: ctSvg('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>', 16),
        image: ctSvg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>', 15),
        copy: ctSvg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>', 15),
        download: ctSvg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>', 15),
        drop: ctSvg('<path d="M12 2.7 6.3 9a7 7 0 1 0 11.4 0z"/>', 15),
        bold: ctSvg('<path d="M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z"/>', 15),
        plus: ctSvg('<path d="M12 5v14M5 12h14"/>', 13),
        back: ctSvg('<path d="M14.5 6 8.5 12l6 6"/>', 17),
        upload: ctSvg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>', 15),
        room: ctSvg('<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 20 12z"/>', 15)
    };

    // ── 방 이름 · 그림 (튜너 목록 캐시에서) ──
    function hpChatInfo(chatId) {
        if (!chatId) return null;
        const items = archiveSearchState?.items || [];
        for (const item of items) if (item.chatId === chatId) return item;
        return null;
    }
    function hpRoomTitle(rec) {
        if (!rec.chatId) return '방 밖에서 칠한 것';
        const info = hpChatInfo(rec.chatId);
        return info?.title || rec.title || '이름 모를 방';
    }
    function hpRoomHref(rec) {
        const info = hpChatInfo(rec.chatId);
        if (info?.href) return info.href;
        if (rec.path && /\/episodes\//.test(rec.path)) return rec.path;
        return rec.storyId && rec.chatId ? `/stories/${rec.storyId}/episodes/${rec.chatId}` : '';
    }
    function hpThumb(rec, size = 30) {
        const info = hpChatInfo(rec.chatId);
        const box = ctEl('span', 'crk-hp-thumb');
        box.style.width = box.style.height = `${size}px`;
        box.style.fontSize = `${Math.round(size * 0.42)}px`;
        if (info?.imageUrl) {
            const img = document.createElement('img');
            img.src = info.imageUrl;
            img.alt = '';
            img.loading = 'lazy';
            box.append(img);
        } else {
            box.textContent = (hpRoomTitle(rec) || '?').trim().charAt(0) || '?';
        }
        return box;
    }

    // ── 말한 사람 · 턴 채우기 (튜너가 받는 대화 기록으로) ──
    function hpStrip(text) {
        // 크랙 기록에는 *지문* 같은 표시가 남아 있어서 비교할 때 뺀다.
        return String(text || '').replace(/[\s*_~`#>]/g, '');
    }
    function hpTurnText(rec) {
        if (Number.isFinite(rec.tnum)) return `T${rec.tnum}`;
        if (!rec.matched || rec.missing) return '';
        return rec.turn ? `${rec.turn}턴` : '프롤로그';
    }
    function hpGuessCharName(rec) {
        const info = hpChatInfo(rec.chatId);
        return (info?.storyName || rec.storyName || '').trim();
    }
    // 튜너 목록에서 찾은 방 이름을 기록에도 적어 둔다(목록 캐시가 비어도 이름이 남게).
    function hpRememberTitles() {
        const ups = [];
        for (const rec of hp.all) {
            const info = hpChatInfo(rec.chatId);
            if (info && (rec.title !== info.title || rec.storyName !== info.storyName)) ups.push({ ...rec, title: info.title || rec.title || '', storyName: info.storyName || '' });
        }
        if (ups.length) hpPutMany(ups).catch(() => {});
    }
    // 내 메시지면 나, 캐릭터 메시지면 따옴표 안은 캐릭터 이름 · 밖은 서술.
    function hpAutoWho(rec, message) {
        if (!message) return '';
        if (message.role === 'user') return 'me';
        const target = hpStrip(rec.text);
        if (/^["“'‘「『]/.test(String(rec.text || '').trim())) return hpGuessCharName(rec) || 'narr';
        const lines = String(message.text || '').split(/\n+/);
        for (const line of lines) {
            const stripped = hpStrip(line);
            const at = stripped.indexOf(target);
            if (at === -1) continue;
            const before = stripped.slice(0, at);
            const count = re => (before.match(re) || []).length;
            const inside = count(/"/g) % 2 === 1 || count(/“/g) > count(/”/g) || count(/「/g) > count(/」/g) || count(/『/g) > count(/』/g) || count(/‘/g) > count(/’/g);
            return inside ? (hpGuessCharName(rec) || 'narr') : 'narr';
        }
        return '';
    }
    function hpFindMessage(rec, messages) {
        if (!messages?.length) return null;
        if (rec.messageId && RS_ID.test(rec.messageId)) {
            // 칠할 때 화면에서 읽은 메시지 번호가 있으면 그것만 믿는다(같은 문구가 든 다른 메시지로 바꾸지 않음).
            return messages.find(m => m.id === rec.messageId) || null;
        }
        const target = hpStrip(rec.text);
        if (!target) return null;
        // 같은 문구가 여러 번 나오면 가장 최근 메시지를 고른다.
        for (let i = messages.length - 1; i >= 0; i--) {
            if (hpStrip(messages[i].text).includes(target)) return messages[i];
        }
        return null;
    }
    function hpApplyMessage(rec, m) {
        const next = { ...rec, messageId: m.id, role: m.role, turn: m.turn, tnum: Number.isFinite(m.tnum) ? m.tnum : undefined, matched: true };
        if (rec.whoAuto !== false && !rec.who) next.who = hpAutoWho(rec, m) || '';
        return next;
    }
    // 지금 방 대화 기록이 이미 있으면 바로 채운다(새로 칠할 때).
    function hpFillFromLog(rec) {
        if (rs.chatId !== rec.chatId || !rs.open || !rs.complete || rs.loading || rs.refreshing || !rs.messages?.length) return;
        const m = hpFindMessage(rec, rs.messages);
        if (m) Object.assign(rec, hpApplyMessage(rec, m));
    }
    async function hpLogFor(chatId, signal) {
        if (chatId === rs.chatId && rs.complete && rs.messages.length) return rs.messages;
        const cached = await rsCacheGet(chatId);
        let raw = cached && cached.complete && Array.isArray(cached.raw) ? cached.raw : null;
        if (raw) {
            try { raw = await rsRefreshRaw(chatId, raw, signal); } catch (e) { /* 저장해 둔 기록으로 */ }
        } else {
            raw = [];
            const ids = new Set();
            await rsFetchPages(chatId, list => {
                for (const m of list) {
                    const slim = rsSlim(m);
                    if (slim._id && !ids.has(slim._id)) { ids.add(slim._id); raw.push(slim); }
                }
            }, signal);
        }
        return rsBuild(raw, true).messages;
    }
    // 턴 · 말한 사람이 비어 있는 방을 하나씩 천천히 채운다.
    async function hpMatchPending({ onlyChat = '' } = {}) {
        if (hp.matchBusy || !hp.ready) return;
        hp.matchBusy = true;
        try {
            for (;;) {
                const pending = hp.all.filter(r => r.chatId && !r.matched && !hp.matchDone.has(r.chatId) && (!onlyChat || r.chatId === onlyChat));
                if (!pending.length) break;
                const chatId = pending[0].chatId;
                hp.matchDone.add(chatId);
                hp.matchRoom = chatId;
                hpEmit();
                let messages = null;
                let gone = false;
                try { messages = await hpLogFor(chatId); } catch (e) { messages = null; gone = e?.status === 404 || e?.status === 403; }
                if (gone) await hpPutMany(hp.all.filter(r => r.chatId === chatId && !r.matched).map(r => ({ ...r, matched: true, missing: true }))).catch(() => {});
                if (messages) {
                    const updates = [];
                    for (const rec of hp.all.filter(r => r.chatId === chatId && !r.matched)) {
                        const m = hpFindMessage(rec, messages);
                        updates.push(m ? hpApplyMessage(rec, m) : { ...rec, matched: true, missing: true });
                    }
                    if (updates.length) await hpPutMany(updates).catch(() => {});
                }
                await new Promise(r => setTimeout(r, 1500));
            }
        } finally {
            hp.matchBusy = false;
            hp.matchRoom = '';
            hpEmit();
        }
    }
    function hpPendingCount() {
        return hp.all.filter(r => r.chatId && !r.matched).length;
    }

    // ── 옛 형광펜 노트 기록 옮기기 ──
    function hpChatIdFromLegacyPath(path) {
        const m = /\/episodes\/([a-f0-9]{24})/i.exec(String(path || ''));
        return m ? m[1].toLowerCase() : '';
    }
    function hpReadLegacy() {
        const rooms = [];
        let keys = [];
        try { keys = Object.keys(localStorage).filter(k => k.startsWith(HP_LEGACY_PREFIX + '/')); } catch (e) { return { rooms, settings: {}, keys: [] }; }
        for (const key of keys) {
            let list;
            try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { continue; }
            if (!Array.isArray(list) || !list.length) continue;
            const path = key.slice(HP_LEGACY_PREFIX.length);
            const chatId = hpChatIdFromLegacyPath(path);
            const recs = list.filter(h => h && h.text).map((h, i) => ({
                id: `L${(chatId || hpStrip(path)).slice(-10)}_${String(h.id || '').replace(/[^A-Za-z0-9_-]/g, '') || `x${hpHash(`${path}|${i}|${h.text}`)}`}`,
                chatId, path, storyId: hpStoryIdFromPath(path),
                text: String(h.text),
                color: typeof h.color === 'string' ? { bg: hpColor(h.color), text: '' } : { bg: hpColor(h.color?.bg), text: h.color?.text ? hpColor(h.color.text, '') : '' },
                note: String(h.note || ''),
                createdAt: Number(h.timestamp) || Number(h.id) || Date.now(),
                messageId: '', role: '', turn: 0, who: '', whoAuto: true, legacy: true
            }));
            if (recs.length) rooms.push({ key, path, chatId, recs });
        }
        const settings = {};
        try {
            const pal = JSON.parse(localStorage.getItem(HP_LEGACY_PREFIX + 'Palette') || 'null');
            if (Array.isArray(pal) && pal.length) settings.palette = pal.map(c => (typeof c === 'string' ? { bg: hpColor(c), text: '' } : { bg: hpColor(c?.bg), text: c?.text ? hpColor(c.text, '') : '' })).slice(0, HP_MAX_COLORS);
            const op = localStorage.getItem(HP_LEGACY_PREFIX + 'Opacity');
            if (op !== null && Number.isFinite(parseFloat(op))) settings.opacity = Math.min(1, Math.max(0.05, parseFloat(op)));
            const bold = localStorage.getItem(HP_LEGACY_PREFIX + 'Bold');
            if (bold !== null) settings.bold = bold === 'true';
        } catch (e) {}
        // 지울 칸 = 읽은 방 칸 + 알려진 설정 칸만(읽지 못한 칸은 건드리지 않는다).
        const clearKeys = [...rooms.map(r => r.key), ...['Palette', 'PopupPos', 'Opacity', 'Bold'].map(k => HP_LEGACY_PREFIX + k)].filter(k => { try { return localStorage.getItem(k) !== null; } catch (e) { return false; } });
        return { rooms, settings, keys: clearKeys };
    }
    function hpHash(text) {
        let h = 5381;
        for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
        return (h >>> 0).toString(36);
    }
    function hpLegacyNew(legacy) {
        // 이미 옮긴 것은 빼고 센다(옛 확프를 켠 채 더 칠했을 수 있다).
        // 이미 옮겼거나(옮긴 뒤 지운 것 포함) 저장소에 있는 것은 빼고 센다.
        return legacy.rooms.map(room => ({ ...room, recs: room.recs.filter(r => !hp.byId.has(r.id) && !hp.legacyIds.has(r.id)) })).filter(room => room.recs.length);
    }
    // 원래 칸을 비우기 전에, 메모리가 아니라 저장소에 실제로 있는지 확인한다.
    async function hpLegacyUnsaved() {
        const legacy = hpReadLegacy();
        let keys;
        try { keys = new Set(await hpTx('hl', 'readonly', st => st.getAllKeys())); } catch (e) { return { legacy, unsaved: null }; }
        const unsaved = legacy.rooms.flatMap(r => r.recs).filter(r => !keys.has(r.id) && !hp.legacyIds.has(r.id));
        return { legacy, unsaved };
    }
    function hpCheckLegacy({ manual = false } = {}) {
        if (!hp.ready) return;
        if (document.getElementById('hlp-toolbar-btn') || document.getElementById('hlp-popup')) {
            if (!hp.oldWarned) {
                hp.oldWarned = true;
                hpToast('옛 형광펜 노트가 켜져 있어요. 끄면 글에 두 번 칠해지지 않아요');
            }
        }
        if (hp.legacyChecked && !manual) return;
        hp.legacyChecked = true;
        const legacy = hpReadLegacy();
        const fresh = hpLegacyNew(legacy);
        hp.legacyLeft = legacy.rooms.length;
        if (!fresh.length) {
            if (manual) hpOpenMigrate(legacy, fresh);
            return;
        }
        if (!manual && hp.settings.migrateLater && hp.settings.migrateLater > Date.now()) return;
        hpOpenMigrate(legacy, fresh);
    }
    function hpMigrateEl() {
        let el = document.getElementById('crk-hp-migrate');
        if (el) return el;
        el = ctEl('div', 'crk-hp-modal');
        el.id = 'crk-hp-migrate';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', '형광펜 기록 옮기기');
        el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') hpCloseMigrate(); });
        el.addEventListener('keyup', e => e.stopPropagation());
        document.body.appendChild(el);
        return el;
    }
    function hpCloseMigrate() {
        document.getElementById('crk-hp-migrate')?.remove();
    }
    function hpOpenMigrate(legacy, fresh) {
        const el = hpMigrateEl();
        const total = fresh.reduce((n, room) => n + room.recs.length, 0);
        const card = ctEl('div', 'crk-hp-modal-card');
        const head = ctEl('div', 'crk-hp-modal-head');
        head.innerHTML = `${HP_IC.hl}<strong></strong>`;
        head.querySelector('strong').textContent = total ? '형광펜 노트 기록을 튜너로 옮길까요?' : '옮길 새 기록이 없어요';
        const close = ctEl('button', 'crk-hp-ib');
        close.type = 'button';
        close.innerHTML = HP_IC.x;
        close.setAttribute('aria-label', '닫기');
        close.addEventListener('click', hpCloseMigrate);
        head.append(close);
        card.append(head);
        if (total) {
            card.append(ctEl('p', 'crk-hp-modal-sub', `방 ${fresh.length}개 · 문구 ${total}개. 원래 기록은 그대로 두고 복사해요.`));
            const list = ctEl('div', 'crk-hp-mig-list');
            const named = fresh.map(room => {
                const sample = room.recs[0];
                return { room, title: room.chatId ? (hpChatInfo(room.chatId)?.title || '') : '', last: Math.max(...room.recs.map(r => r.createdAt || 0)) };
            }).sort((a, b) => b.last - a.last);
            for (const { room, title } of named) {
                const row = ctEl('div', 'crk-hp-mig-row');
                row.append(hpThumb(room.recs[0], 22));
                const name = ctEl('span', 'crk-hp-mig-name', room.chatId ? (title || '이름 모를 방') : '방 밖에서 칠한 것');
                if (!title) name.classList.add('is-faint');
                row.append(name, ctEl('em', '', `${room.recs.length}개`));
                list.append(row);
            }
            card.append(list);
            const unknown = fresh.filter(room => !room.chatId || !hpChatInfo(room.chatId)).length;
            if (unknown) card.append(ctEl('p', 'crk-hp-modal-note', `흐린 이름 ${unknown}곳은 채팅 목록에서 못 찾은 방(지운 방일 수 있음)이나 채팅방이 아닌 화면이에요. 옮긴 뒤 모아보기에서 지울 수 있어요.`));
        }
        const actions = ctEl('div', 'crk-hp-modal-actions');
        if (total) {
            const go = ctEl('button', 'crk-hp-btn is-primary', '옮기기');
            go.type = 'button';
            go.addEventListener('click', () => hpDoMigrate(legacy, fresh, card));
            const later = ctEl('button', 'crk-hp-btn', '나중에');
            later.type = 'button';
            later.addEventListener('click', () => {
                hp.settings.migrateLater = Date.now() + 3 * 86400000;
                hpSaveSettings();
                hpCloseMigrate();
                hpToast('⚙ › 「옛 기록 옮기기」에서 언제든 다시 열 수 있어요');
            });
            actions.append(later, go);
        } else {
            if (legacy.keys.length) actions.append(hpClearLegacyButton(legacy));
            const ok = ctEl('button', 'crk-hp-btn is-primary', '닫기');
            ok.type = 'button';
            ok.addEventListener('click', hpCloseMigrate);
            actions.append(ok);
        }
        card.append(actions);
        el.replaceChildren(card);
        el.classList.add('is-on');
        requestAnimationFrame(() => card.querySelector('.is-primary')?.focus());
    }
    async function hpDoMigrate(legacy, fresh, card) {
        const recs = fresh.flatMap(room => room.recs);
        const actions = card.querySelector('.crk-hp-modal-actions');
        actions.replaceChildren(ctEl('span', 'crk-hp-modal-note', '옮기는 중…'));
        try {
            if (legacy.settings && !hp.settings.migrated) Object.assign(hp.settings, legacy.settings);
            hp.settings.migrated = (hp.settings.migrated || 0) + recs.length;
            await hpPutMany(recs);
            recs.forEach(r => hp.legacyIds.add(r.id));
            await hpSaveLegacyIds();
            await hpSaveSettings();
            const stored = await hpTx('hl', 'readonly', st => st.count());
            const ok = recs.every(r => hp.byId.has(r.id));
            hp.paintSig = '';
            hpPaint(true);
            hpMatchPending();
            const head = card.querySelector('.crk-hp-modal-head strong');
            head.textContent = ok ? `${recs.length}개 옮겼어요` : '일부를 옮기지 못했어요';
            card.querySelectorAll('.crk-hp-modal-sub, .crk-hp-mig-list, .crk-hp-modal-note').forEach(n => n.remove());
            card.insertBefore(ctEl('p', 'crk-hp-modal-sub', ok
                ? `튜너 저장소에 모두 ${stored}개가 있어요. 몇 턴 · 누가 말했는지는 방마다 대화 기록을 받아 천천히 채워요. 이제 옛 형광펜 노트는 꺼 주세요.`
                : '다시 열어서 한 번 더 옮겨 주세요. 원래 기록은 그대로 있어요.'), actions);
            if (ok) card.insertBefore(ctEl('p', 'crk-hp-modal-note', '원래 칸(크랙 저장 공간)의 옛 기록은 그대로 있어요. 확인이 끝나면 비워서 자리를 만들 수 있어요.'), actions);
            const done = ctEl('button', 'crk-hp-btn is-primary', '확인');
            done.type = 'button';
            done.addEventListener('click', hpCloseMigrate);
            actions.replaceChildren(...(ok ? [hpClearLegacyButton(legacy)] : []), done);
        } catch (e) {
            actions.replaceChildren(ctEl('span', 'crk-hp-modal-note', '옮기지 못했어요. 원래 기록은 그대로 있어요.'));
        }
    }
    function hpClearLegacyButton(legacy) {
        const b = ctEl('button', 'crk-hp-btn is-danger', '원래 칸 비우기');
        b.type = 'button';
        let armed = false;
        b.addEventListener('click', async () => {
            // 옮긴 게 저장소에 다 있는지 한 번 더 본다.
            const { legacy: now, unsaved } = await hpLegacyUnsaved();
            if (unsaved === null) { hpToast('저장소를 확인하지 못해서 비우지 않았어요'); return; }
            if (unsaved.length) { hpToast(`아직 안 옮긴 기록 ${unsaved.length}개가 있어서 비우지 않았어요`); return; }
            if (!armed) { armed = true; b.textContent = '한 번 더 누르면 비워요'; return; }
            let n = 0;
            for (const key of now.keys) { try { localStorage.removeItem(key); n++; } catch (e) {} }
            hp.legacyLeft = 0;
            b.disabled = true;
            b.textContent = `${n}칸 비웠어요`;
        });
        return b;
    }

    // ── 「이 방에서 찾기」 패널의 형광펜 탭 ──
    const HP_TAB_KEY = 'crkTunerRsTab_v1';
    const HP_JUMP_KEY = 'crkTunerHpJump_v1';
    Object.assign(hp, { fillTried: new Set(), panelDirty: false, indexAsked: false, scope: 'room', sort: 'group', color: '', query: '', queryOpen: false, openId: '', groupsOpen: null, panelSig: '', panelPop: '', bmScope: 'room', bmAll: null });

    function hpLastTab() {
        try { const t = localStorage.getItem(HP_TAB_KEY); return t === 'bm' || t === 'hl' ? t : 'search'; } catch (e) { return 'search'; }
    }
    function hpRememberTab(tab) {
        try { localStorage.setItem(HP_TAB_KEY, tab); } catch (e) {}
    }
    function hpWhen(ts) {
        const date = new Date(Number(ts) || Date.now());
        const now = new Date();
        const day = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const diff = Math.round((day(now) - day(date)) / 86400000);
        if (diff === 0) return `오늘 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        if (diff === 1) return '어제';
        if (date.getFullYear() !== now.getFullYear()) return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
        return `${date.getMonth() + 1}월 ${date.getDate()}일`;
    }
    function hpMatches(rec) {
        if (hp.color && !hpSameColor(hp.settings.palette[+hp.color], rec.color)) return false;
        const q = hp.query.trim().toLowerCase();
        if (!q) return true;
        return [rec.text, rec.note, hpNameOf(rec), hpRoomTitle(rec)].some(v => String(v || '').toLowerCase().includes(q));
    }
    function hpPhrase(rec) {
        const span = ctEl('span', 'crk-hp-ph', rec.text);
        if (hp.settings.marks) {
            span.classList.add('is-marked');
            span.style.background = hpRgba(rec.color?.bg, Math.max(0.35, Math.min(0.75, hp.settings.opacity)));
            if (rec.color?.text) span.style.color = rec.color.text;
        }
        return span;
    }
    function hpPanelRoot() {
        return rs.root?.querySelector('.crs-hl') || null;
    }
    function hpRenderPanel(force = false) {
        const box = hpPanelRoot();
        if (!box || rs.tab !== 'hl' || !rs.open) { hp.panelSig = ''; return; }
        // 패널 안 입력칸 · 막대를 쓰는 중이면 다시 그리지 않고, 손을 뗀 뒤에 그린다.
        if (!force && document.activeElement?.closest?.('.crs-hl') && document.activeElement.matches('input, textarea')) { hp.panelDirty = true; return; }
        const chatId = rs.chatId || rsChatIdFromPath();
        const sig = [hp.version, chatId, hp.scope, hp.sort, hp.color, hp.query, hp.queryOpen, hp.openId, String(hp.groupsOpen && [...hp.groupsOpen]), hp.settings.marks].join('|');
        if (!force && sig === hp.panelSig && box.childElementCount) return;
        hp.panelSig = sig;
        const roomRecs = hpRoomRecs(chatId);
        // 이 방 대화 기록을 이미 받았으면 턴 · 말한 사람이 빈 문구를 바로 채운다(새 요청 없이).
        if (rs.open && rs.complete && !rs.loading && !rs.refreshing && rs.chatId === chatId && rs.messages.length) {
            const ups = roomRecs.filter(r => !r.matched && !hp.fillTried.has(r.id)).map(r => {
                hp.fillTried.add(r.id);
                const m = hpFindMessage(r, rs.messages);
                // 화면에서 읽은 메시지 번호가 기록에 없으면(다른 답변 갈래 등) 못 찾음으로 정하지 않고 둔다.
                return m ? hpApplyMessage(r, m) : r.messageId ? null : { ...r, matched: true, missing: true };
            }).filter(Boolean);
            if (ups.length) { hpPutMany(ups).catch(() => {}); return; }
        }
        const list = (hp.scope === 'all' ? hp.all : roomRecs).filter(hpMatches);
        const frag = document.createDocumentFragment();
        // 도구 줄
        const tools = ctEl('div', 'crs-hl-tools');
        const seg = ctEl('div', 'crs-hl-seg');
        seg.style.setProperty('--i', hp.scope === 'all' ? '1' : '0');
        seg.innerHTML = '<i aria-hidden="true"></i>';
        for (const [v, label, n] of [['room', '이 방', roomRecs.length], ['all', '모든 방', hp.all.length]]) {
            const b = ctEl('button');
            b.type = 'button';
            b.dataset.act = 'hpscope';
            b.dataset.v = v;
            b.setAttribute('aria-selected', String(hp.scope === v));
            b.append(label, ctEl('b', '', String(n)));
            seg.append(b);
        }
        tools.append(seg, ctEl('span', 'crs-hl-sp'));
        const ib = (act, icon, title, on = false) => {
            const b = ctEl('button', `crs-icon crs-hl-ib${on ? ' is-on' : ''}`);
            b.type = 'button';
            b.dataset.act = act;
            b.title = title;
            b.setAttribute('aria-label', title);
            b.innerHTML = icon;
            return b;
        };
        if (hp.scope === 'all') tools.append(ib('hpsort', hp.sort === 'time' ? HP_IC.layers : HP_IC.clock, hp.sort === 'time' ? '방별로 묶기' : '최근순', hp.sort === 'time'));
        tools.append(ib('hpquery', HP_IC.search, '형광펜 찾기', hp.queryOpen), ib('hpexpand', HP_IC.expand, '펼쳐보기'), ib('hpgear', HP_IC.gear, '설정', hp.panelPop === 'gear'), ib('hpinfo', HP_IC.info, '쓰는 법', hp.panelPop === 'info'));
        frag.append(tools);
        if (hp.queryOpen) {
            const row = ctEl('div', 'crs-hl-query');
            const input = ctEl('input', 'crs-hl-q');
            input.type = 'search';
            input.placeholder = '문구 · 메모 · 말한 사람';
            input.value = hp.query;
            input.setAttribute('aria-label', '형광펜 찾기');
            row.append(input);
            frag.append(row);
        }
        // 색 거르기
        const colors = ctEl('div', 'crs-hl-colors');
        hp.settings.palette.forEach((c, i) => {
            const b = ctEl('button', `crs-hl-dot${hp.color === String(i) ? ' is-on' : ''}`);
            b.type = 'button';
            b.dataset.act = 'hpcolor';
            b.dataset.v = String(i);
            b.style.setProperty('--n', String(i));
            b.style.background = hpSwatch(c);
            b.title = '이 색만';
            colors.append(b);
        });
        if (hp.scope === 'all') colors.append(ctEl('span', 'crs-hl-lbl', `방 ${new Set(list.map(r => r.chatId || r.path)).size}개`));
        if (hp.matchRoom) colors.append(ctEl('span', 'crs-hl-lbl is-busy', '턴 · 말한 사람 채우는 중'));
        frag.append(colors);
        // 목록
        const box2 = ctEl('div', 'crs-hl-list');
        box2.setAttribute('role', 'list');
        if (!list.length) {
            box2.append(ctEl('div', 'crs-empty', hp.query || hp.color ? '맞는 형광펜이 없어요' : hp.scope === 'all' ? '아직 칠한 형광펜이 없어요' : '이 방 글을 드래그해서 색을 고르면 여기에 모여요'));
        } else if (hp.scope === 'room') {
            [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).forEach((rec, n) => box2.append(hpItem(rec, n)));
        } else if (hp.sort === 'time') {
            [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).forEach((rec, n) => box2.append(hpCompact(rec, n, true)));
        } else {
            const groups = hpGroups(list);
            if (!hp.groupsOpen) hp.groupsOpen = new Set(groups.slice(0, 2).map(g => g.key));
            groups.forEach((g, n) => box2.append(hpGroup(g, n, chatId)));
        }
        frag.append(box2);
        box.replaceChildren(frag);
        hpRenderPanelPop();
        const count = rs.root?.querySelector('.crs-hl-count');
        if (count) count.textContent = roomRecs.length ? String(roomRecs.length) : '';
    }
    function hpGroups(list) {
        const map = new Map();
        for (const rec of list) {
            const key = rec.chatId || `path:${rec.path}`;
            if (!map.has(key)) map.set(key, { key, chatId: rec.chatId, items: [] });
            map.get(key).items.push(rec);
        }
        const groups = [...map.values()];
        groups.forEach(g => { g.items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); g.last = g.items[0].createdAt || 0; });
        const here = rsChatIdFromPath();
        return groups.sort((a, b) => (b.chatId === here) - (a.chatId === here) || b.last - a.last);
    }
    function hpMeta(rec) {
        const meta = ctEl('span', 'crs-item-meta');
        const turn = hpTurnText(rec);
        if (turn) meta.append(ctEl('span', 'crs-chip', turn));
        const who = hpNameOf(rec);
        meta.append(ctEl('span', 'crs-who', `${who ? `${who} · ` : ''}${hpWhen(rec.createdAt)}`));
        return meta;
    }
    function hpItem(rec, n) {
        const open = hp.openId === rec.id;
        const item = ctEl('div', `crs-hl-item${open ? ' is-open' : ''}`);
        item.dataset.id = rec.id;
        item.style.setProperty('--n', String(Math.min(n, 12)));
        item.style.setProperty('--c', rec.color?.bg || '#ffe066');
        item.setAttribute('role', 'listitem');
        const head = ctEl('button', 'crs-hl-head');
        head.type = 'button';
        head.dataset.act = 'hpopen';
        head.setAttribute('aria-expanded', String(open));
        const text = ctEl('span', 'crs-hl-text');
        text.append(hpPhrase(rec));
        head.append(text);
        if (rec.note) {
            const memo = ctEl('span', 'crs-hl-memo');
            memo.innerHTML = HP_IC.pen;
            memo.append(ctEl('span', '', rec.note));
            head.append(memo);
        }
        head.append(hpMeta(rec));
        item.append(head);
        if (open) {
            const acts = ctEl('div', 'crs-hl-acts');
            const go = ctEl('button', 'crs-btn is-primary', '대화에서 보기');
            go.type = 'button';
            go.dataset.act = 'hpgoto';
            acts.append(go);
            const dots = ctEl('span', 'crs-hl-mini');
            hp.settings.palette.forEach((c, i) => {
                const d = ctEl('button', hpSameColor(c, rec.color) ? 'is-on' : '');
                d.type = 'button';
                d.dataset.act = 'hprecolor';
                d.dataset.v = String(i);
                d.style.background = hpSwatch(c);
                d.setAttribute('aria-label', `${i + 1}번 색으로`);
                dots.append(d);
            });
            acts.append(dots);
            const mk = (act, icon, title, cls = '') => {
                const b = ctEl('button', `crs-icon ${cls}`);
                b.type = 'button';
                b.dataset.act = act;
                b.title = title;
                b.setAttribute('aria-label', title);
                b.innerHTML = icon;
                return b;
            };
            acts.append(mk('hpmemo', HP_IC.pen, '메모'), mk('hpwho', HP_IC.user, '말한 사람'), mk('hpexport', HP_IC.share, '내보내기'), mk('hpdel', HP_IC.trash, '지우기', 'crs-hl-del'));
            item.append(acts);
            if (hp.memoId === rec.id) {
                const row = ctEl('div', 'crs-hl-memo-edit');
                const input = ctEl('input', 'crs-hl-memo-in');
                input.type = 'text';
                input.maxLength = 300;
                input.placeholder = '메모 (Enter 저장)';
                input.value = rec.note || '';
                row.append(input);
                item.append(row);
                requestAnimationFrame(() => input.focus());
            }
        }
        return item;
    }
    function hpCompact(rec, n, showRoom) {
        const row = ctEl('button', `crs-hl-c${hp.focusId === rec.id ? ' is-current' : ''}`);
        row.type = 'button';
        row.dataset.act = 'hpjump';
        row.dataset.id = rec.id;
        row.style.setProperty('--n', String(Math.min(n, 14)));
        if (showRoom) row.append(hpThumb(rec, 20));
        const dot = ctEl('i', 'crs-hl-cdot');
        dot.style.background = rec.color?.bg || '#ffe066';
        const text = ctEl('span', 'crs-hl-ctext');
        text.append(hpPhrase(rec));
        if (rec.note) text.append(ctEl('span', 'crs-hl-cnote', ` · ${rec.note}`));
        row.append(dot, text, ctEl('span', 'crs-hl-cturn', showRoom ? hpWhen(rec.createdAt) : (hpTurnText(rec) || hpWhen(rec.createdAt))));
        return row;
    }
    function hpGroup(g, n, here) {
        const open = hp.groupsOpen?.has(g.key);
        const sec = ctEl('div', `crs-hl-grp${open ? ' is-open' : ''}`);
        sec.style.setProperty('--n', String(Math.min(n, 10)));
        const head = ctEl('button', 'crs-hl-gh');
        head.type = 'button';
        head.dataset.act = 'hpgroup';
        head.dataset.v = g.key;
        head.setAttribute('aria-expanded', String(!!open));
        head.append(hpThumb(g.items[0], 30));
        const name = ctEl('span', 'crs-hl-gname');
        name.append(ctEl('b', '', hpRoomTitle(g.items[0])), ctEl('span', '', `${hpWhen(g.last)} 칠함`));
        head.append(name);
        if (g.chatId && g.chatId === here) head.append(ctEl('span', 'crs-hl-here', '지금 방'));
        else {
            const dots = ctEl('span', 'crs-hl-gdots');
            g.items.slice(0, 6).forEach(r => { const d = ctEl('i'); d.style.background = r.color?.bg || '#ffe066'; dots.append(d); });
            head.append(dots);
        }
        head.append(ctEl('span', 'crs-hl-num', String(g.items.length)));
        const chev = ctEl('span', 'crs-hl-chev');
        chev.innerHTML = RS_ICON.down;
        head.append(chev);
        const body = ctEl('div', 'crs-hl-gbody');
        const inner = ctEl('div');
        g.items.forEach((rec, i) => inner.append(hpCompact(rec, i, false)));
        body.append(inner);
        sec.append(head, body);
        return sec;
    }

    // 패널 안 누르기 (rsOnClick에서 hp로 시작하는 data-act를 넘겨받는다)
    function hpOnPanelAct(act, el) {
        const item = el.closest('.crs-hl-item');
        const rec = item ? hp.byId.get(item.dataset.id) : el.dataset.id ? hp.byId.get(el.dataset.id) : null;
        switch (act) {
            case 'hpscope': hp.scope = el.dataset.v === 'all' ? 'all' : 'room'; hp.openId = ''; if (hp.scope === 'all') hpEnsureTitles(); break;
            case 'hpsort': hp.sort = hp.sort === 'time' ? 'group' : 'time'; break;
            case 'hpquery': hp.queryOpen = !hp.queryOpen; if (!hp.queryOpen) hp.query = ''; else requestAnimationFrame(() => hpPanelRoot()?.querySelector('.crs-hl-q')?.focus()); break;
            case 'hpcolor': hp.color = hp.color === el.dataset.v ? '' : el.dataset.v; break;
            case 'hpgroup': { const set = hp.groupsOpen || new Set(); set.has(el.dataset.v) ? set.delete(el.dataset.v) : set.add(el.dataset.v); hp.groupsOpen = set; break; }
            case 'hpopen': hp.openId = hp.openId === rec?.id ? '' : rec?.id || ''; hp.memoId = ''; hp.delArmed = ''; break;
            case 'hpgoto': if (rec) hpGoto(rec); return;
            case 'hpjump': if (rec) hpGoto(rec); return;
            case 'hprecolor': if (rec) { const c = hp.settings.palette[+el.dataset.v]; if (c) { hpPut({ ...rec, color: { bg: c.bg, text: c.text || '' } }); document.querySelectorAll(`mark.crk-hl[data-hp="${CSS.escape(rec.id)}"]`).forEach(m => hpMarkStyle(m, hp.byId.get(rec.id))); } } return;
            case 'hpmemo': hp.memoId = hp.memoId === rec?.id ? '' : rec?.id || ''; break;
            case 'hpwho': if (rec) hpOpenWhoPop(rec.id, el.getBoundingClientRect()); return;
            case 'hpexport': if (rec) hpOpenExport([rec.id]); return;
            case 'hpdel':
                if (!rec) return;
                if (hp.delArmed !== rec.id) { hp.delArmed = rec.id; el.classList.add('is-armed'); el.title = '한 번 더 누르면 지워요'; return; }
                hp.delArmed = '';
                hpRemove(rec.id);
                hpToast('형광펜을 지웠어요', { undo: rec });
                return;
            case 'hpexpand': hpOpenLounge(); return;
            case 'hpgear': hp.panelPop = hp.panelPop === 'gear' ? '' : 'gear'; break;
            case 'hpinfo': hp.panelPop = hp.panelPop === 'info' ? '' : 'info'; break;
            case 'hpbmscope': hp.bmScope = el.dataset.v === 'all' ? 'all' : 'room'; if (hp.bmScope === 'all') hpEnsureTitles(); hpSyncBmTools(); rsRenderBm(); return;
            case 'hpbmjump': hpBmJump(el.dataset.chat, el.dataset.id); return;
            default: if (act.startsWith('hpset')) { hpOnSettingAct(act, el); return; }
        }
        hpRenderPanel(true);
    }
    function hpOnPanelInput(event) {
        const t = event.target;
        if (t.classList?.contains('crs-hl-q')) {
            hp.query = t.value;
            clearTimeout(hp.queryTimer);
            hp.queryTimer = setTimeout(() => {
                const pos = t.selectionStart;
                hpRenderPanel(true);
                const input = hpPanelRoot()?.querySelector('.crs-hl-q');
                if (input) { input.focus(); try { input.setSelectionRange(pos, pos); } catch (e) {} }
            }, 160);
            return true;
        }
        if (t.classList?.contains('crs-hl-op')) {
            hp.settings.opacity = Math.min(1, Math.max(0.05, parseFloat(t.value) || 0.4));
            hpApplyVars();
            hpRestyleAll();
            clearTimeout(hp.opTimer);
            hp.opTimer = setTimeout(() => hpSaveSettings({ emit: false }), 300);
            return true;
        }
        return false;
    }
    function hpOnPanelKeydown(event) {
        const t = event.target;
        if (event.key === 'Enter' && t.classList?.contains('crs-hl-memo-in') && !event.isComposing) {
            const rec = hp.byId.get(hp.memoId);
            if (rec) hpPut({ ...rec, note: t.value.trim() });
            hp.memoId = '';
            hpRenderPanel(true);
            return true;
        }
        return false;
    }
    // Esc를 패널에서 먼저 받는다(열린 작은 창 → 메모 → 펼친 항목 순).
    function hpPanelEsc() {
        if (rs.tab !== 'hl') return false;
        if (hp.panelPop) { hp.panelPop = ''; hpRenderPanel(true); return true; }
        if (hp.memoId) { hp.memoId = ''; hpRenderPanel(true); return true; }
        if (hp.queryOpen) { hp.queryOpen = false; hp.query = ''; hpRenderPanel(true); return true; }
        if (hp.openId) { hp.openId = ''; hpRenderPanel(true); return true; }
        return false;
    }

    // ── 설정 · 쓰는 법 작은 창 ──
    function hpRenderPanelPop() {
        const host = hpPanelRoot();
        if (!host) return;
        host.querySelector('.crs-hl-pop')?.remove();
        if (!hp.panelPop) return;
        const pop = ctEl('div', `crs-hl-pop is-${hp.panelPop}`);
        if (hp.panelPop === 'info') {
            pop.innerHTML = `<div class="crs-hl-pop-h">${HP_IC.hl}<b>형광펜 쓰는 법</b></div><ol><li>글을 드래그하면 색 알약이 떠요</li><li>칠한 곳을 누르면 색 · 메모 · 말한 사람 · 지우기</li><li>목록에서 누르면 그 방 그 문장으로 가요</li><li>⤢ 펼쳐보기에서 모아 보고 그림 · PDF로 내보내요</li></ol>`;
        } else {
            pop.append(hpSettingsBody());
        }
        host.append(pop);
    }
    function hpSettingsBody() {
        const body = ctEl('div', 'crs-hl-set');
        const row = (icon, label, control) => {
            const r = ctEl('div', 'crs-hl-set-row');
            const ic = ctEl('span', 'crs-hl-set-ic');
            ic.innerHTML = icon;
            r.append(ic, ctEl('span', 'crs-hl-set-lbl', label), control);
            return r;
        };
        const op = ctEl('input', 'crs-hl-op');
        op.type = 'range';
        op.min = '0.05';
        op.max = '1';
        op.step = '0.05';
        op.value = String(hp.settings.opacity);
        op.setAttribute('aria-label', '진하기');
        const sw = (on, act, label) => {
            const b = ctEl('button', `crs-hl-sw${on ? ' is-on' : ''}`);
            b.type = 'button';
            b.dataset.act = act;
            b.setAttribute('role', 'switch');
            b.setAttribute('aria-checked', String(on));
            b.setAttribute('aria-label', label);
            b.innerHTML = '<i></i>';
            return b;
        };
        body.append(row(HP_IC.drop, '진하기', op), row(HP_IC.bold, '굵게', sw(hp.settings.bold, 'hpsetbold', '굵게')), row(HP_IC.hl, '목록 글에도 칠하기', sw(hp.settings.marks, 'hpsetmarks', '목록 글에도 칠하기')));
        body.append(ctEl('div', 'crs-hl-set-h', '내 색'));
        const pal = ctEl('div', 'crs-hl-pal');
        hp.settings.palette.forEach((c, i) => {
            const b = ctEl('button', `crs-hl-pal-dot${hp.palArmed === i ? ' is-armed' : ''}`);
            b.type = 'button';
            b.dataset.act = 'hpsetpaldel';
            b.dataset.v = String(i);
            b.style.background = hpSwatch(c);
            b.title = hp.palArmed === i ? '한 번 더 누르면 빼요' : '누르면 빼기';
            pal.append(b);
        });
        if (hp.settings.palette.length < HP_MAX_COLORS) {
            const add = ctEl('label', 'crs-hl-pal-add');
            add.title = '색 더하기';
            add.innerHTML = HP_IC.plus;
            const input = ctEl('input');
            input.type = 'color';
            input.value = '#f783ac';
            input.addEventListener('change', () => {
                hp.settings.palette = [...hp.settings.palette, { bg: input.value, text: '' }].slice(0, HP_MAX_COLORS);
                hpSaveSettings();
                hpRenderPanel(true);
            });
            add.append(input);
            pal.append(add);
        }
        body.append(pal, ctEl('hr'));
        const line = (act, icon, label, cls = '') => {
            const b = ctEl('button', `crs-hl-set-btn ${cls}`);
            b.type = 'button';
            b.dataset.act = act;
            b.innerHTML = icon;
            b.append(ctEl('span', '', label));
            return b;
        };
        body.append(line('hpsetbackup', HP_IC.download, '백업 파일 저장'), line('hpsetrestore', HP_IC.upload, '백업 파일 불러오기'));
        if (hp.legacyLeft) body.append(line('hpsetlegacy', HP_IC.hl, '옛 형광펜 노트 기록 옮기기'));
        body.append(ctEl('hr'), line('hpsetwipe', HP_IC.trash, hp.wipeArmed ? '한 번 더 누르면 전부 지워요' : '형광펜 전부 지우기', 'is-danger'));
        return body;
    }
    function hpOnSettingAct(act, el) {
        if (act === 'hpsetbold') { hp.settings.bold = !hp.settings.bold; hpSaveSettings(); }
        else if (act === 'hpsetmarks') { hp.settings.marks = !hp.settings.marks; hpSaveSettings(); }
        else if (act === 'hpsetpaldel') {
            const i = +el.dataset.v;
            if (hp.settings.palette.length <= 1) { hpToast('색은 하나는 남겨야 해요'); return; }
            if (hp.palArmed !== i) { hp.palArmed = i; hpRenderPanel(true); return; }
            hp.palArmed = -1;
            hp.settings.palette = hp.settings.palette.filter((_, k) => k !== i);
            if (hp.color === String(i)) hp.color = '';
            hpSaveSettings();
        }
        else if (act === 'hpsetbackup') { hpDownloadBackup(); return; }
        else if (act === 'hpsetrestore') { hpPickBackup(); return; }
        else if (act === 'hpsetlegacy') { hp.panelPop = ''; hpCheckLegacy({ manual: true }); }
        else if (act === 'hpsetwipe') {
            if (!hp.wipeArmed) { hp.wipeArmed = true; hpRenderPanel(true); setTimeout(() => { hp.wipeArmed = false; }, 4000); return; }
            hp.wipeArmed = false;
            const backup = hp.all.slice();
            hpDownloadBackup(backup, '지우기 전 백업');
            // 저장소 안에도 지우기 전 사본을 남기고(되돌리기용), 다 지운 걸 확인한 뒤에 화면을 비운다.
            hpTx('meta', 'readwrite', st => st.put({ k: 'wiped', at: Date.now(), items: backup }))
                .then(() => hpTx('hl', 'readwrite', st => st.clear()))
                .then(() => {
                    backup.forEach(r => hpUnpaint(r.id));
                    hp.all = [];
                    hp.byId = new Map();
                    hpEmit();
                    hpToast('형광펜을 전부 지웠어요', { action: { label: '되돌리기', run: () => hpPutMany(backup).then(() => { hp.paintSig = ''; hpPaint(true); hpToast(`${backup.length}개를 되돌렸어요`); }).catch(() => {}) } });
                })
                .catch(() => hpToast('지우지 못했어요. 형광펜은 그대로예요'));
        }
        hpRenderPanel(true);
    }

    // ── 대화에서 보기 · 다른 방으로 가기 ──
    async function hpGoto(rec) {
        const here = rsChatIdFromPath();
        if (rec.chatId !== here) {
            const href = hpRoomHref(rec);
            if (!href) { hpToast('이 방 주소를 못 찾았어요'); return; }
            try { sessionStorage.setItem(HP_JUMP_KEY, JSON.stringify({ kind: 'hl', chatId: rec.chatId, id: rec.id, at: Date.now() })); } catch (e) {}
            location.href = href;
            return;
        }
        hp.focusId = rec.id;
        const flashMark = () => {
            hp.paintSig = '';
            hpPaint(true);
            const mark = document.querySelector(`mark.crk-hl[data-hp="${CSS.escape(rec.id)}"]`);
            if (!mark) return false;
            mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
            document.querySelectorAll(`mark.crk-hl[data-hp="${CSS.escape(rec.id)}"]`).forEach(m => { m.classList.remove('is-flash'); void m.offsetWidth; m.classList.add('is-flash'); });
            return true;
        };
        if (flashMark()) return;
        if (!rs.open) rsOpen({ focus: false });
        // 대화 기록에서 그 메시지를 찾아 튜너의 「대화에서 보기」로 불러온다.
        for (let i = 0; i < 60 && !rs.complete && rs.open; i++) await rsWait(300);
        const m = hpFindMessage(rec, rs.messages);
        if (!m) { hpToast('이 문구가 든 메시지를 못 찾았어요 (지웠거나 다시 생성했을 수 있어요)'); return; }
        if (!rec.matched || rec.messageId !== m.id) hpPut(hpApplyMessage(rec, m));
        const ok = await rsGoto(m.id);
        if (ok) setTimeout(flashMark, 450);
    }
    function hpTakePendingJump() {
        let job = null;
        try { job = JSON.parse(sessionStorage.getItem(HP_JUMP_KEY) || 'null'); sessionStorage.removeItem(HP_JUMP_KEY); } catch (e) {}
        if (!job || Date.now() - (job.at || 0) > 120000 || job.chatId !== rsChatIdFromPath()) return;
        let tries = 0;
        const run = () => {
            if (!document.querySelector('[data-message-group-id]') && tries++ < 40) { setTimeout(run, 400); return; }
            rsOpen({ focus: false });
            if (job.kind === 'bm') {
                rsSetTab('bm');
                const go = () => { const b = rs.bm.items.find(x => x.messageId === job.id); if (b) rsBmGoto(b); else if (tries++ < 40) setTimeout(go, 300); };
                go();
            } else {
                rsSetTab('hl');
                hpWhenReady(() => { const rec = hp.byId.get(job.id); if (rec) hpGoto(rec); });
            }
        };
        setTimeout(run, 600);
    }

    // 「모든 방」을 처음 볼 때 튜너 채팅 목록을 받아 방 이름을 채운다(목록 캐시가 비어 있을 수 있어서).
    function hpEnsureTitles() {
        if (hp.indexAsked || typeof ensureArchiveSearchIndex !== 'function') return;
        hp.indexAsked = true;
        ensureArchiveSearchIndex().then(() => { hpRememberTitles(); hp.panelSig = ''; hpRenderPanel(true); if (hp.bmScope === 'all' && rs.tab === 'bm') hpRenderBmAll(); if (hpL.open) hpRenderLounge(true); }).catch(() => {});
    }

    // ── 북마크 「모든 방」 ──
    async function hpLoadAllBookmarks() {
        const db = await rsDb();
        if (!db) return [];
        return new Promise(resolve => {
            try {
                const req = db.transaction(RS_BM_STORE, 'readonly').objectStore(RS_BM_STORE).getAll();
                req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
                req.onerror = () => resolve([]);
            } catch (e) { resolve([]); }
        });
    }
    function hpBmScopeBar() {
        const seg = ctEl('div', 'crs-hl-seg crs-bm-scope');
        seg.style.setProperty('--i', hp.bmScope === 'all' ? '1' : '0');
        seg.innerHTML = '<i aria-hidden="true"></i>';
        for (const [v, label] of [['room', '이 방'], ['all', '모든 방']]) {
            const b = ctEl('button', '', label);
            b.type = 'button';
            b.dataset.act = 'hpbmscope';
            b.dataset.v = v;
            b.setAttribute('aria-selected', String(hp.bmScope === v));
            seg.append(b);
        }
        return seg;
    }
    function hpSyncBmTools() {
        const tools = rs.root?.querySelector('.crs-bm-tools');
        if (!tools) return;
        tools.querySelector('.crs-bm-scope')?.remove();
        tools.prepend(hpBmScopeBar());
        rs.root.dataset.bmscope = hp.bmScope;
    }
    async function hpRenderBmAll() {
        const list = rs.root?.querySelector('.crs-bm-list');
        if (!list) return;
        rs.root.querySelector('.crs-bm-count').textContent = '';
        const rows = await hpLoadAllBookmarks();
        if (hp.bmScope !== 'all') return;
        const here = rsChatIdFromPath();
        const groups = rows.filter(r => Array.isArray(r.items) && r.items.length).map(r => ({ chatId: r.chatId, items: [...r.items].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)) }));
        groups.forEach(g => { g.last = g.items[0].createdAt || 0; });
        groups.sort((a, b) => (b.chatId === here) - (a.chatId === here) || b.last - a.last);
        const total = groups.reduce((n, g) => n + g.items.length, 0);
        rs.root.querySelector('.crs-bm-count').textContent = total ? `방 ${groups.length}개 · 북마크 ${total}개` : '';
        const frag = document.createDocumentFragment();
        if (!total) frag.append(ctEl('div', 'crs-empty', '메시지 ··· 메뉴의 「북마크」로 저장하면 여기에 모여요'));
        groups.forEach((g, n) => {
            const sec = ctEl('div', 'crs-hl-grp is-open');
            sec.style.setProperty('--n', String(Math.min(n, 10)));
            const head = ctEl('div', 'crs-hl-gh is-static');
            head.append(hpThumb({ chatId: g.chatId }, 30));
            const name = ctEl('span', 'crs-hl-gname');
            name.append(ctEl('b', '', hpChatInfo(g.chatId)?.title || '이름 모를 방'), ctEl('span', '', `${hpWhen(g.last)} 저장`));
            head.append(name);
            if (g.chatId === here) head.append(ctEl('span', 'crs-hl-here', '지금 방'));
            head.append(ctEl('span', 'crs-hl-num', String(g.items.length)));
            const body = ctEl('div', 'crs-hl-gbody');
            const inner = ctEl('div');
            g.items.forEach(b => {
                const row = ctEl('button', 'crs-hl-c');
                row.type = 'button';
                row.dataset.act = 'hpbmjump';
                row.dataset.chat = g.chatId;
                row.dataset.id = b.messageId;
                const star = ctEl('i', 'crs-hl-star');
                star.innerHTML = rsStar(13, true);
                const text = ctEl('span', 'crs-hl-ctext');
                text.append(ctEl('b', '', b.title || '저장한 메시지'), ctEl('span', 'crs-hl-cnote', ` · ${b.preview || ''}`));
                row.append(star, text, ctEl('span', 'crs-hl-cturn', b.turnLabel || ''));
                inner.append(row);
            });
            body.append(inner);
            sec.append(head, body);
            frag.append(sec);
        });
        list.replaceChildren(frag);
    }
    function hpBmJump(chatId, messageId) {
        if (chatId === rsChatIdFromPath()) {
            const b = rs.bm.items.find(x => x.messageId === messageId);
            if (b) rsBmGoto(b);
            return;
        }
        const info = hpChatInfo(chatId);
        const known = hp.all.find(r => r.chatId === chatId);
        const href = info?.href || (known && hpRoomHref(known)) || '';
        if (!href) { hpToast('이 방 주소를 못 찾았어요 (채팅 목록을 다시 받은 뒤 해 보세요)'); return; }
        try { sessionStorage.setItem(HP_JUMP_KEY, JSON.stringify({ kind: 'bm', chatId, id: messageId, at: Date.now() })); } catch (e) {}
        location.href = href;
    }

    // ── 펼쳐보기: 형광펜 모아보기 (카드 1 「책 밑줄」) ──
    const hpL = { open: false, room: '', sort: 'room', query: '', color: '', selecting: false, picked: new Set(), sig: '' };

    function hpLoungeEl() {
        let root = document.getElementById('crk-hp-lounge');
        if (root) return root;
        root = ctEl('section', 'crk-hpl');
        root.id = 'crk-hp-lounge';
        root.setAttribute('aria-label', '형광펜 모아보기');
        root.setAttribute('aria-hidden', 'true');
        root.inert = true;
        root.innerHTML = `
            <header class="crk-hpl-top">
                <button type="button" class="crk-hpl-close" data-hpl="close" aria-label="접기" title="접기 (Esc)">${HP_IC.back}</button>
                <div class="crk-hpl-heading"><strong>형광펜 모아보기</strong><em></em></div>
                <label class="crk-hpl-search">${HP_IC.search}<input type="search" placeholder="문구 · 메모 · 말한 사람" aria-label="형광펜 찾기"></label>
                <div class="crk-hpl-colors" role="group" aria-label="색으로 거르기"></div>
                <div class="crk-hpl-tools">
                    <div class="crk-hpl-seg" role="group" aria-label="보는 방식"><i aria-hidden="true"></i><button type="button" data-hpl="sort" data-v="room">방별</button><button type="button" data-hpl="sort" data-v="time">최근순</button></div>
                    <div class="crk-hpl-qa">
                        <button type="button" data-hpl="marks" title="글에 형광펜 표시" aria-label="글에 형광펜 표시">${HP_IC.hl}</button>
                        <button type="button" data-hpl="select" title="골라서 내보내기" aria-label="골라서 내보내기">${HP_IC.checksq}</button>
                        <button type="button" data-hpl="pdf" title="PDF로 백업" aria-label="PDF로 백업">${HP_IC.file}</button>
                    </div>
                </div>
            </header>
            <div class="crk-hpl-selbar" role="toolbar" aria-label="고른 형광펜">
                <button type="button" data-hpl="pickall">전체 선택</button><button type="button" data-hpl="pickclear">해제</button>
                <span class="crk-hpl-selcount"></span>
                <button type="button" class="is-primary" data-hpl="pickimg">${HP_IC.image}<span>그림으로</span></button>
                <button type="button" data-hpl="pickpdf">${HP_IC.file}<span>PDF로</span></button>
                <button type="button" data-hpl="pickcopy">${HP_IC.copy}<span>복사</span></button>
            </div>
            <div class="crk-hpl-body"><nav class="crk-hpl-rail" aria-label="칠한 방"></nav><div class="crk-hpl-scroll"><div class="crk-hpl-status"></div><div class="crk-hpl-groups"></div></div></div>`;
        root.addEventListener('click', hpOnLoungeClick);
        root.addEventListener('input', event => {
            if (!event.target.matches('.crk-hpl-search input')) return;
            hpL.query = event.target.value;
            clearTimeout(hpL.qTimer);
            hpL.qTimer = setTimeout(() => hpRenderLounge(true), 160);
        });
        root.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.target.classList?.contains('crk-bk-who-in') && !event.isComposing) {
                if (event.key === 'Enter') { event.preventDefault(); hpSaveInlineWho(event.target); return; }
                if (event.key === 'Escape') { event.preventDefault(); event.target.dataset.done = '1'; hpL.whoEdit = ''; hpRenderLounge(true); return; }
            }
            if (event.key !== 'Escape' || event.isComposing) return;
            event.preventDefault();
            if (document.getElementById('crk-hp-export')?.classList.contains('is-on')) hpCloseExport();
            else if (hp.editId) hpCloseEdit();
            else if (hpL.selecting) { hpL.selecting = false; hpL.picked.clear(); hpRenderLounge(true); }
            else hpCloseLounge();
        });
        root.addEventListener('keyup', e => e.stopPropagation());
        root.addEventListener('focusout', event => { if (event.target.classList?.contains('crk-bk-who-in')) hpSaveInlineWho(event.target); });
        document.body.appendChild(root);
        return root;
    }
    function hpSaveInlineWho(input) {
        if (input.dataset.done) return;
        input.dataset.done = '1';
        const rec = hp.byId.get(input.dataset.id);
        hpL.whoEdit = '';
        if (!rec) { hpRenderLounge(true); return; }
        const value = input.value.trim();
        if (!value || value === hpNameOf({ ...rec, who: '', whoAuto: true })) hpSetWho(rec.id, '__auto', false);
        else if (value !== hpNameOf(rec)) hpSetWho(rec.id, value, true);
        else hpRenderLounge(true);
    }
    function hpPlaceLounge() {
        const root = document.getElementById('crk-hp-lounge');
        if (!root) return;
        positionLounge(root, document.querySelector('.crack-search-container'));
    }
    function hpOpenLounge() {
        const root = hpLoungeEl();
        hpL.open = true;
        hpPlaceLounge();
        root.inert = false;
        root.setAttribute('aria-hidden', 'false');
        hpRenderLounge(true);
        requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('is-open')));
        if (typeof ensureArchiveSearchIndex === 'function') ensureArchiveSearchIndex().then(() => hpL.open && hpRenderLounge(true)).catch(() => {});
        if (hpPendingCount()) hpMatchPending();
        setTimeout(() => { if (!isMobileLounge()) root.querySelector('.crk-hpl-search input')?.focus({ preventScroll: true }); }, 380);
    }
    function hpCloseLounge() {
        const root = document.getElementById('crk-hp-lounge');
        hpL.open = false;
        hpL.selecting = false;
        hpL.picked.clear();
        hpCloseEdit();
        hpCloseExport();
        if (!root) return;
        root.classList.remove('is-open');
        root.inert = true;
        root.setAttribute('aria-hidden', 'true');
        rs.root?.querySelector('[data-act="hpexpand"]')?.focus({ preventScroll: true });
    }
    function hpLoungeList() {
        const q = hpL.query.trim().toLowerCase();
        return hp.all.filter(rec => (!hpL.room || (rec.chatId || `path:${rec.path}`) === hpL.room)
            && (!hpL.color || hpSameColor(hp.settings.palette[+hpL.color], rec.color))
            && (!q || [rec.text, rec.note, hpNameOf(rec), hpRoomTitle(rec)].some(v => String(v || '').toLowerCase().includes(q))));
    }
    function hpRenderLounge(force = false) {
        const root = document.getElementById('crk-hp-lounge');
        if (!root || !hpL.open) return;
        const sig = [hp.version, hpL.room, hpL.sort, hpL.query, hpL.color, hpL.selecting, [...hpL.picked].join(','), hp.settings.marks, hp.matchRoom || '', hpL.whoEdit || ''].join('|');
        if (!force && sig === hpL.sig) return;
        hpL.sig = sig;
        const all = hp.all;
        const roomKeys = hpGroups(all);
        root.querySelector('.crk-hpl-heading em').textContent = `방 ${roomKeys.length} · 문구 ${all.length}`;
        root.classList.toggle('is-selecting', hpL.selecting);
        root.querySelector('[data-hpl="marks"]').classList.toggle('is-on', !!hp.settings.marks);
        root.querySelector('[data-hpl="select"]').classList.toggle('is-on', hpL.selecting);
        const seg = root.querySelector('.crk-hpl-seg');
        seg.style.setProperty('--i', hpL.sort === 'time' ? '1' : '0');
        seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === hpL.sort)));
        // 색
        const colors = root.querySelector('.crk-hpl-colors');
        colors.replaceChildren();
        const allBtn = ctEl('button', `crk-hpl-cf is-all${hpL.color ? '' : ' is-on'}`, '전체');
        allBtn.type = 'button';
        allBtn.dataset.hpl = 'color';
        allBtn.dataset.v = '';
        colors.append(allBtn);
        hp.settings.palette.forEach((c, i) => {
            const b = ctEl('button', `crk-hpl-cf${hpL.color === String(i) ? ' is-on' : ''}`);
            b.type = 'button';
            b.dataset.hpl = 'color';
            b.dataset.v = String(i);
            b.style.setProperty('--d', c.bg);
            b.style.setProperty('--n', String(i));
            b.setAttribute('aria-label', `${i + 1}번 색만`);
            colors.append(b);
        });
        // 왼쪽: 칠한 방
        const rail = root.querySelector('.crk-hpl-rail');
        rail.replaceChildren();
        const railBtn = (key, label, count, iconNode) => {
            const b = ctEl('button', `crk-hpl-rb${hpL.room === key ? ' is-on' : ''}`);
            b.type = 'button';
            b.dataset.hpl = 'room';
            b.dataset.v = key;
            if (typeof iconNode === 'string') { const ic = ctEl('span', 'crk-hpl-rb-ic'); ic.innerHTML = iconNode; b.append(ic); } else b.append(iconNode);
            b.append(ctEl('i', '', label), ctEl('em', '', String(count)));
            return b;
        };
        rail.append(railBtn('', '전체', all.length, HP_IC.hl), ctEl('div', 'crk-hpl-rh', '칠한 방'));
        roomKeys.forEach(g => rail.append(railBtn(g.key, hpRoomTitle(g.items[0]), g.items.length, hpThumb(g.items[0], 20))));
        // 본문
        const list = hpLoungeList();
        const status = root.querySelector('.crk-hpl-status');
        status.textContent = hp.matchRoom ? `턴 · 말한 사람 채우는 중 · 남은 문구 ${hpPendingCount()}개` : '';
        const box = root.querySelector('.crk-hpl-groups');
        const frag = document.createDocumentFragment();
        let n = 0;
        if (!list.length) {
            frag.append(ctEl('div', 'crk-hpl-empty', all.length ? '맞는 형광펜이 없어요' : '아직 칠한 형광펜이 없어요. 채팅방 글을 드래그해서 색을 골라 보세요'));
        } else if (hpL.sort === 'time') {
            const cols = ctEl('div', 'crk-bk-cols');
            [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).forEach(rec => cols.append(hpBookEntry(rec, n++, true)));
            frag.append(cols);
        } else {
            const groups = hpGroups(list);
            const multi = groups.filter(g => g.items.length >= 2);
            const single = groups.filter(g => g.items.length === 1);
            for (const g of multi) {
                const sec = ctEl('section', 'crk-bk-group');
                sec.append(hpBookHead(g));
                const cols = ctEl('div', 'crk-bk-cols');
                g.items.forEach(rec => cols.append(hpBookEntry(rec, n++, false)));
                sec.append(cols);
                frag.append(sec);
            }
            if (single.length) {
                const sec = ctEl('section', 'crk-bk-group');
                const head = ctEl('header', 'crk-bk-gh is-single');
                const t = ctEl('div', 'crk-bk-t');
                t.append(ctEl('strong', '', '한 줄씩 칠한 방'));
                head.append(t, ctEl('span', 'crk-bk-sp'), ctEl('em', '', String(single.length)));
                sec.append(head);
                const cols = ctEl('div', 'crk-bk-cols');
                single.forEach(g => cols.append(hpBookEntry(g.items[0], n++, true)));
                sec.append(cols);
                frag.append(sec);
            }
        }
        box.replaceChildren(frag);
        root.querySelector('.crk-hpl-selcount').textContent = `${hpL.picked.size}개 골랐어요`;
    }
    function hpRoomInfoLine(rec, count) {
        const info = hpChatInfo(rec.chatId);
        const bits = [];
        if (info?.storyName && info.storyName !== info.title) bits.push(info.storyName);
        if (!rec.chatId) bits.push('채팅방이 아닌 화면');
        else if (!info) bits.push('채팅 목록에 없는 방');
        bits.push(`${hpWhen(rec.createdAt)} 칠함`);
        return bits.join(' · ');
    }
    function hpBookHead(g) {
        const head = ctEl('header', 'crk-bk-gh');
        head.append(hpThumb(g.items[0], 30));
        const t = ctEl('div', 'crk-bk-t');
        t.append(ctEl('strong', '', hpRoomTitle(g.items[0])), ctEl('span', '', hpRoomInfoLine(g.items[0])));
        head.append(t, ctEl('span', 'crk-bk-sp'));
        const ib = (act, icon, title) => {
            const b = ctEl('button', 'crk-hp-ib');
            b.type = 'button';
            b.dataset.hpl = act;
            b.dataset.v = g.key;
            b.title = title;
            b.setAttribute('aria-label', title);
            b.innerHTML = icon;
            return b;
        };
        if (g.chatId) head.append(ib('openroom', HP_IC.go, '방 열기'));
        head.append(ib('roompdf', HP_IC.file, '이 방 PDF로'), ib('roomimg', HP_IC.share, '이 방 전부 그림으로'), ctEl('em', '', String(g.items.length)));
        return head;
    }
    function hpBookEntry(rec, n, single) {
        const picked = hpL.picked.has(rec.id);
        const el = ctEl('article', `crk-bk${picked ? ' is-picked' : ''}`);
        el.dataset.id = rec.id;
        el.style.setProperty('--c', rec.color?.bg || '#ffe066');
        el.style.setProperty('--n', String(Math.min(n, 16)));
        if (hpL.selecting) {
            const pick = ctEl('button', 'crk-bk-pick');
            pick.type = 'button';
            pick.dataset.hpl = 'pick';
            pick.setAttribute('aria-pressed', String(picked));
            pick.setAttribute('aria-label', '고르기');
            if (picked) pick.innerHTML = HP_IC.check;
            el.append(pick);
        }
        const meta = ctEl('div', 'crk-bk-meta');
        meta.append(ctEl('i'));
        if (single) meta.append(ctEl('b', '', hpRoomTitle(rec)), ' · ');
        const turn = hpTurnText(rec);
        meta.append(`${turn ? `${turn} · ` : ''}${hpWhen(rec.createdAt)}`);
        if (rec.missing) meta.append(ctEl('span', 'crk-bk-miss', ' · 메시지 못 찾음'));
        const acts = ctEl('span', 'crk-bk-acts');
        const ib = (act, icon, title) => {
            const b = ctEl('button', 'crk-hp-ib');
            b.type = 'button';
            b.dataset.hpl = act;
            b.title = title;
            b.setAttribute('aria-label', title);
            b.innerHTML = icon;
            return b;
        };
        acts.append(ib('export', HP_IC.share, '내보내기'), ib('goto', HP_IC.go, '그 문장으로'), ib('more', HP_IC.more, '색 · 메모 · 말한 사람 · 지우기'));
        meta.append(acts);
        el.append(meta);
        const q = ctEl('div', 'crk-bk-q');
        q.append(hpPhrase(rec));
        el.append(q);
        // 아래 이름 줄: 누르면 그 자리에서 고친다(비우고 Enter = 처음대로).
        if (hpL.whoEdit === rec.id) {
            const input = ctEl('input', 'crk-bk-who-in');
            input.type = 'text';
            input.maxLength = 30;
            input.dataset.id = rec.id;
            input.value = hpNameOf(rec);
            input.placeholder = hpGuessCharName(rec) || '이름';
            input.setAttribute('aria-label', '카드에 쓸 이름');
            el.append(input);
            requestAnimationFrame(() => { input.focus(); input.select(); });
        } else {
            const name = hpNameOf(rec);
            const who = ctEl('button', `crk-bk-who${name ? '' : ' is-empty'}`, name ? `— ${name}` : '+ 이름');
            who.type = 'button';
            who.dataset.hpl = 'who';
            who.title = '눌러서 이름 고치기';
            el.append(who);
        }
        if (rec.note) el.append(ctEl('div', 'crk-bk-note', rec.note));
        return el;
    }
    function hpOnLoungeClick(event) {
        const el = event.target.closest('[data-hpl]');
        if (!el) return;
        const act = el.dataset.hpl;
        const entry = el.closest('.crk-bk');
        const rec = entry ? hp.byId.get(entry.dataset.id) : null;
        const groupRecs = key => hp.all.filter(r => (r.chatId || `path:${r.path}`) === key);
        switch (act) {
            case 'close': hpCloseLounge(); return;
            case 'sort': hpL.sort = el.dataset.v === 'time' ? 'time' : 'room'; break;
            case 'color': hpL.color = el.dataset.v || ''; break;
            case 'room': hpL.room = el.dataset.v || ''; break;
            case 'marks': hp.settings.marks = !hp.settings.marks; hpSaveSettings(); break;
            case 'select': hpL.selecting = !hpL.selecting; hpL.picked.clear(); break;
            case 'pdf': hpPrintPdf(hpLoungeList()); return;
            case 'pick': if (rec) hpL.picked.has(rec.id) ? hpL.picked.delete(rec.id) : hpL.picked.add(rec.id); break;
            case 'pickall': hpLoungeList().forEach(r => hpL.picked.add(r.id)); break;
            case 'pickclear': hpL.picked.clear(); break;
            case 'pickimg': if (!hpL.picked.size) { hpToast('먼저 문구를 골라 주세요'); return; } hpOpenExport([...hpL.picked]); return;
            case 'pickpdf': if (!hpL.picked.size) { hpToast('먼저 문구를 골라 주세요'); return; } hpPrintPdf(hp.all.filter(r => hpL.picked.has(r.id))); return;
            case 'pickcopy': if (!hpL.picked.size) { hpToast('먼저 문구를 골라 주세요'); return; } hpCopyText(hp.all.filter(r => hpL.picked.has(r.id))); return;
            case 'export': if (rec) hpOpenExport([rec.id]); return;
            case 'goto': if (rec) { hpCloseLounge(); hpGoto(rec); } return;
            case 'more': if (rec) hpOpenEdit(rec.id, el.getBoundingClientRect()); return;
            case 'who': if (rec) hpL.whoEdit = rec.id; break;
            case 'openroom': { const r = groupRecs(el.dataset.v)[0]; const href = r && hpRoomHref(r); if (href) location.href = href; return; }
            case 'roompdf': hpPrintPdf(groupRecs(el.dataset.v)); return;
            case 'roomimg': hpOpenExport(groupRecs(el.dataset.v).map(r => r.id)); return;
            default: return;
        }
        hpRenderLounge(true);
    }

    // ── 내보내기: 그림 저장 · 그림 복사 · 글 복사 ──
    const hpX = { ids: [], style: 'hl', bg: '', who: true, turn: true, date: false, note: true, marks: false, size: 1 };
    const HP_BG = { paper: { bg: '#fbfaf6', fg: '#1a1918' }, dark: { bg: '#1d1c1a', fg: '#f0efeb' }, yellow: { bg: '#fff3b0', fg: '#3a2c00' }, clear: { bg: '', fg: '' } };
    const HP_STYLE_BG = { hl: 'paper', quote: 'dark', memo: 'yellow' };
    const HP_X_MAX = 20;
    function hpExportEl() {
        let el = document.getElementById('crk-hp-export');
        if (el) return el;
        el = ctEl('div', 'crk-hp-modal crk-hp-export');
        el.id = 'crk-hp-export';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', '내보내기');
        el.addEventListener('click', hpOnExportClick);
        el.addEventListener('input', e => {
            const r = e.target.closest?.('[data-hpx-size]');
            if (!r) return;
            hpX.size = Math.min(130, Math.max(85, Number(r.value) || 100)) / 100;
            const out = el.querySelector('.crk-hpx-size-v');
            if (out) out.textContent = `${Math.round(hpX.size * 100)}%`;
            if (!hp.xRaf) hp.xRaf = requestAnimationFrame(() => { hp.xRaf = 0; hpUpdateExport(); });
        });
        el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') hpCloseExport(); });
        el.addEventListener('keyup', e => e.stopPropagation());
        document.body.appendChild(el);
        return el;
    }
    function hpCloseExport() {
        const el = document.getElementById('crk-hp-export');
        if (el) el.classList.remove('is-on');
    }
    function hpOpenExport(ids) {
        hpX.ids = ids.filter(id => hp.byId.has(id));
        if (!hpX.ids.length) return;
        if (!hpX.bg) hpX.bg = HP_STYLE_BG[hpX.style];
        hpRenderExport();
        hpExportEl().classList.add('is-on');
    }
    function hpRenderExport() {
        const el = hpExportEl();
        const recs = hpX.ids.map(id => hp.byId.get(id)).filter(Boolean);
        const first = recs[0];
        const card = ctEl('div', `crk-hp-modal-card crk-hpx${isMobileLounge() ? ' is-sheet' : ''}`);
        const head = ctEl('div', 'crk-hp-modal-head');
        head.innerHTML = `${HP_IC.share}<strong>내보내기</strong>`;
        head.append(ctEl('span', 'crk-hpx-src', recs.length > 1 ? `문구 ${recs.length}개` : `${hpRoomTitle(first)}${hpTurnText(first) ? ` · ${hpTurnText(first)}` : ''}`));
        const close = ctEl('button', 'crk-hp-ib');
        close.type = 'button';
        close.dataset.hpx = 'close';
        close.setAttribute('aria-label', '닫기');
        close.innerHTML = HP_IC.x;
        head.append(close);
        const body = ctEl('div', 'crk-hpx-body');
        const prev = ctEl('div', 'crk-hpx-prev');
        const canvas = hpDrawCards(recs.slice(0, HP_X_MAX), hpX);
        canvas.className = 'crk-hpx-canvas';
        prev.append(canvas);
        if (recs.length > HP_X_MAX) prev.append(ctEl('p', 'crk-hpx-note', `문구가 많아서 ${Math.ceil(recs.length / HP_X_MAX)}장으로 나눠 저장해요`));
        const side = ctEl('div', 'crk-hpx-side');
        const row = (icon, title, content) => {
            const r = ctEl('div', 'crk-hpx-row');
            const l = ctEl('span', 'crk-hpx-lbl');
            l.title = title;
            l.innerHTML = icon;
            r.append(l, content);
            return r;
        };
        const styles = ctEl('div', 'crk-hpx-styles');
        for (const [k, label] of [['hl', '형광펜'], ['quote', '인용'], ['memo', '메모지']]) {
            const b = ctEl('button', `crk-hpx-st${hpX.style === k ? ' is-on' : ''}`);
            b.type = 'button';
            b.dataset.hpx = 'style';
            b.dataset.v = k;
            b.append(ctEl('span', `crk-hpx-mini is-${k}`), ctEl('i', '', label));
            styles.append(b);
        }
        const chips = ctEl('div', 'crk-hpx-chips');
        for (const [k, label, icon] of [['who', '이름', HP_IC.user], ['turn', '턴', ''], ['date', '날짜', HP_IC.clock], ['note', '메모', HP_IC.pen], ['marks', '형광펜 자국', HP_IC.hl]]) {
            const b = ctEl('button', hpX[k] ? 'is-on' : '');
            b.type = 'button';
            b.dataset.hpx = 'chip';
            b.dataset.v = k;
            b.innerHTML = icon;
            b.append(label);
            chips.append(b);
        }
        const bgs = ctEl('div', 'crk-hpx-bg');
        for (const k of Object.keys(HP_BG)) {
            const b = ctEl('button', `${hpX.bg === k ? 'is-on' : ''}${k === 'clear' ? ' is-clear' : ''}`);
            b.type = 'button';
            b.dataset.hpx = 'bg';
            b.dataset.v = k;
            if (HP_BG[k].bg) b.style.background = HP_BG[k].bg;
            b.setAttribute('aria-label', { paper: '밝은 종이', dark: '어두운 바탕', yellow: '노란 메모지', clear: '투명' }[k]);
            bgs.append(b);
        }
        const btns = ctEl('div', 'crk-hpx-btns');
        const btn = (act, icon, label, cls = '') => {
            const b = ctEl('button', `crk-hp-btn ${cls}`);
            b.type = 'button';
            b.dataset.hpx = act;
            b.innerHTML = icon;
            b.append(label);
            return b;
        };
        btns.append(btn('save', HP_IC.download, '그림 저장', 'is-primary'), btn('copyimg', HP_IC.image, '그림 복사'), btn('copytext', HP_IC.copy, '글 복사'));
        // 글 크기: 여백 · 너비는 그대로, 글만 크게 · 작게
        const size = ctEl('div', 'crk-hpx-size');
        const rng = ctEl('input');
        rng.type = 'range';
        rng.min = '85';
        rng.max = '130';
        rng.step = '5';
        rng.value = String(Math.round((hpX.size || 1) * 100));
        rng.dataset.hpxSize = '1';
        rng.setAttribute('aria-label', '글 크기');
        size.append(ctEl('span', 'crk-hpx-ga is-s', '가'), rng, ctEl('span', 'crk-hpx-ga is-l', '가'), ctEl('output', 'crk-hpx-size-v', `${rng.value}%`));
        side.append(row(HP_IC.image, '모양', styles), row('<span class="crk-hpx-ga is-lbl">가</span>', '글 크기', size), row(HP_IC.layers, '넣을 것', chips), row(HP_IC.drop, '바탕', bgs), btns);
        body.append(prev, side);
        card.append(head, body);
        el.replaceChildren(card);
    }
    function hpOnExportClick(event) {
        if (event.target === event.currentTarget) { hpCloseExport(); return; }
        const b = event.target.closest('[data-hpx]');
        if (!b) return;
        const act = b.dataset.hpx;
        const recs = hpX.ids.map(id => hp.byId.get(id)).filter(Boolean);
        if (act === 'close') { hpCloseExport(); return; }
        if (act === 'style') { hpX.style = b.dataset.v; hpX.bg = HP_STYLE_BG[hpX.style]; }
        else if (act === 'chip') hpX[b.dataset.v] = !hpX[b.dataset.v];
        else if (act === 'bg') hpX.bg = b.dataset.v;
        else if (act === 'save') {
            const stamp = hpFileStamp();
            const chunks = [];
            for (let i = 0; i < recs.length; i += HP_X_MAX) chunks.push(recs.slice(i, i + HP_X_MAX));
            chunks.forEach((chunk, i) => setTimeout(() => hpDrawCards(chunk, hpX).toBlob(blob => {
                if (!blob) { hpToast('그림을 만들지 못했어요'); return; }
                hpDownload(blob, `형광펜_${stamp}${chunks.length > 1 ? `_${i + 1}` : ''}.png`);
            }, 'image/png'), i * 400));
            return;
        } else if (act === 'copyimg') {
            if (recs.length > HP_X_MAX) hpToast(`앞의 ${HP_X_MAX}개만 복사해요. 전부는 「그림 저장」을 써 주세요`);
            hpDrawCards(recs.slice(0, HP_X_MAX), hpX).toBlob(async blob => {
                try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); hpToast('그림을 복사했어요'); }
                catch (e) { hpToast('이 브라우저에선 그림 복사가 안 돼요. 「그림 저장」을 써 주세요'); }
            }, 'image/png');
            return;
        } else if (act === 'copytext') { hpCopyText(recs); return; }
        hpUpdateExport();
    }
    function hpUpdateExport() {
        const card = document.querySelector('#crk-hp-export .crk-hpx');
        const old = card?.querySelector('.crk-hpx-canvas');
        if (!card || !old) { hpRenderExport(); return; }
        const recs = hpX.ids.map(id => hp.byId.get(id)).filter(Boolean);
        const canvas = hpDrawCards(recs.slice(0, HP_X_MAX), hpX);
        canvas.className = 'crk-hpx-canvas is-still';
        old.replaceWith(canvas);
        card.querySelectorAll('[data-hpx="style"]').forEach(b => b.classList.toggle('is-on', b.dataset.v === hpX.style));
        card.querySelectorAll('[data-hpx="chip"]').forEach(b => b.classList.toggle('is-on', !!hpX[b.dataset.v]));
        card.querySelectorAll('[data-hpx="bg"]').forEach(b => b.classList.toggle('is-on', b.dataset.v === hpX.bg));
    }
    function hpCopyText(recs) {
        const text = recs.map(rec => {
            const tail = [hpNameOf(rec), hpRoomTitle(rec), hpTurnText(rec)].filter(Boolean).join(' · ');
            return `"${rec.text}"\n— ${tail}${rec.note ? `\n메모: ${rec.note}` : ''}`;
        }).join('\n\n');
        (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => hpToast(`${recs.length}개를 글로 복사했어요`), () => hpToast('복사하지 못했어요'));
    }
    function hpFileStamp() {
        const d = new Date();
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    }
    function hpDownload(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    // 그림은 캔버스에 직접 그린다(외부 라이브러리 없이). 2배 크기로 그려 선명하게.
    function hpWrap(ctx, text, maxW) {
        const lines = [];
        let line = '';
        for (const token of String(text).split(/(\s+)/)) {
            if (!token) continue;
            const trial = line + token;
            if (ctx.measureText(trial).width <= maxW) { line = trial; continue; }
            if (line.trim()) { lines.push(line.trimEnd()); line = token.trim() ? '' : ''; }
            if (!token.trim()) continue;
            for (const ch of token) {
                if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ''; }
                line += ch;
            }
        }
        if (line.trim()) lines.push(line.trimEnd());
        return lines.length ? lines : [''];
    }
    function hpRoundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }
    function hpDrawCards(recs, opt) {
        // 여백은 늘 같고(360 너비 기준 40), 카드 높이는 글 길이를 따른다. 글 크기만 opt.size로 바꾼다.
        const S = 2, W = 360 * S, PAD = 40 * S, GAP = 14 * S;
        const k = Math.min(1.3, Math.max(0.85, Number(opt.size) || 1));
        const family = getComputedStyle(document.body).fontFamily || 'Pretendard, "Malgun Gothic", sans-serif';
        const serif = 'Batang, "바탕", "Nanum Myeongjo", serif';
        const look = HP_BG[opt.bg] || HP_BG.paper;
        const dark = opt.bg === 'dark' || (opt.bg === 'clear' && opt.style === 'quote');
        const fg = look.fg || (dark ? '#f0efeb' : '#1a1918');
        const soft = dark ? 'rgba(240,239,235,.62)' : 'rgba(26,25,24,.6)';
        const rule = dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.1)';
        const FS = 17 * S * k;
        const qFont = opt.style === 'quote' ? `700 ${FS}px ${serif}` : `600 ${FS}px ${family}`;
        const LH = FS * 1.75;
        const PARA = LH * 0.45;
        const NOTE = 12.5 * S * k;
        const NOTE_LH = 20 * S * k;
        const TOP = opt.style === 'quote' ? 30 * S * k : opt.style === 'memo' ? 8 * S : 0;
        const FOOT = 18 * S + 26 * S;
        const measure = document.createElement('canvas').getContext('2d');
        const layouts = recs.map(rec => {
            measure.font = qFont;
            const lines = String(rec.text).split('\n').flatMap((para, i) => (i ? [''] : []).concat(hpWrap(measure, para, W - PAD * 2)));
            measure.font = `500 ${NOTE}px ${family}`;
            const noteLines = opt.note && rec.note ? hpWrap(measure, `✎ ${rec.note}`, W - PAD * 2) : [];
            const who = opt.who ? hpNameOf(rec) : '';
            const footBits = [opt.turn ? hpTurnText(rec) : '', opt.date ? hpWhen(rec.createdAt) : ''].filter(Boolean);
            const hasFoot = !!who || footBits.length > 0;
            let h = PAD + TOP + lines.reduce((n, l) => n + (l ? LH : PARA), 0);
            if (noteLines.length) h += 10 * S + noteLines.length * NOTE_LH;
            if (hasFoot) h += FOOT;
            h += PAD - 4 * S;
            return { rec, lines, noteLines, who, footBits, hasFoot, h: Math.ceil(h) };
        });
        const total = layouts.reduce((n, l) => n + l.h, 0) + GAP * (layouts.length - 1);
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = Math.max(1, Math.ceil(total));
        const ctx = canvas.getContext('2d');
        let y = 0;
        for (const L of layouts) {
            const { rec } = L;
            ctx.save();
            if (look.bg) { hpRoundRect(ctx, 0, y, W, L.h, 18 * S); ctx.fillStyle = look.bg; ctx.fill(); }
            if (opt.style === 'memo') { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.save(); ctx.translate(W / 2, y + 4 * S); ctx.rotate(0.05); ctx.fillRect(-45 * S, -6 * S, 90 * S, 20 * S); ctx.restore(); }
            let cy = y + PAD;
            if (opt.style === 'quote') {
                ctx.fillStyle = '#ffe066';
                ctx.font = `700 ${56 * S * k}px Georgia, serif`;
                ctx.textBaseline = 'top';
                ctx.fillText('“', PAD - 4 * S, cy - 14 * S);
            }
            cy += TOP;
            ctx.font = qFont;
            ctx.textBaseline = 'middle';
            for (const line of L.lines) {
                if (!line) { cy += PARA; continue; }
                const mid = cy + LH / 2;
                if (opt.marks && opt.style !== 'quote') {
                    const w = ctx.measureText(line).width;
                    ctx.fillStyle = hpRgba(rec.color?.bg || '#ffe066', 0.6);
                    hpRoundRect(ctx, PAD - 3 * S, mid - 12 * S * k, w + 6 * S, 24 * S * k, 5 * S);
                    ctx.fill();
                }
                ctx.fillStyle = fg;
                ctx.fillText(line, PAD, mid);
                cy += LH;
            }
            if (L.noteLines.length) {
                cy += 10 * S;
                ctx.font = `500 ${NOTE}px ${family}`;
                ctx.fillStyle = soft;
                for (const line of L.noteLines) { ctx.fillText(line, PAD, cy + NOTE_LH / 2); cy += NOTE_LH; }
            }
            // 아래 줄: 왼쪽 인물 이름, 오른쪽 턴 · 날짜 (방 이름 · 동그라미 없음)
            if (L.hasFoot) {
                const fy = y + L.h - PAD - 22 * S;
                ctx.fillStyle = rule;
                ctx.fillRect(PAD, fy - 12 * S, W - PAD * 2, 1 * S);
                let right = 0;
                if (L.footBits.length) {
                    const t = L.footBits.join(' · ');
                    ctx.font = `500 ${11.5 * S}px ${family}`;
                    ctx.fillStyle = soft;
                    ctx.textAlign = 'right';
                    ctx.fillText(t, W - PAD, fy + 8 * S);
                    ctx.textAlign = 'left';
                    right = ctx.measureText(t).width + 12 * S;
                }
                if (L.who) {
                    ctx.font = `700 ${13 * S}px ${opt.style === 'quote' ? serif : family}`;
                    ctx.fillStyle = fg;
                    const maxW = W - PAD * 2 - right;
                    let t = L.who;
                    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
                    ctx.fillText(t === L.who ? t : `${t}…`, PAD, fy + 8 * S);
                }
            }
            ctx.restore();
            y += L.h + GAP;
        }
        return canvas;
    }

    // ── PDF (크롬 인쇄 창의 「PDF로 저장」) ──
    function hpPrintPdf(recs) {
        if (!recs.length) { hpToast('PDF로 만들 형광펜이 없어요'); return; }
        const w = window.open('', '_blank');
        if (!w) { hpToast('새 창이 막혔어요. 이 사이트의 팝업을 허용해 주세요'); return; }
        const groups = hpGroups(recs);
        const d = new Date();
        const body = groups.map(g => `<section><h2><span class="dot"></span>${hpEsc(hpRoomTitle(g.items[0]))}<small>${hpEsc(hpRoomInfoLine(g.items[0]))}</small></h2>${g.items.map(rec => {
            const meta = [hpNameOf(rec), hpTurnText(rec), hpWhen(rec.createdAt)].filter(Boolean).join(' · ');
            return `<div class="it"><span class="q" style="background:${hpRgba(rec.color?.bg || '#ffe066', 0.5)}">${hpEsc(rec.text)}</span><span class="m">${hpEsc(meta)}</span>${rec.note ? `<div class="n">✎ ${hpEsc(rec.note)}</div>` : ''}</div>`;
        }).join('')}</section>`).join('');
        w.document.open();
        w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>형광펜 모아보기 ${hpFileStamp()}</title><style>
            @page { size: A4; margin: 16mm 15mm; }
            body { margin: 0; color: #1a1918; font-family: Pretendard, "Pretendard Variable", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; font-size: 11pt; }
            header { padding-bottom: 10px; margin-bottom: 14px; border-bottom: 2px solid #1a1918; }
            header b { display: block; font-size: 20pt; font-weight: 800; letter-spacing: -.02em; }
            header span { color: #85837d; font-size: 9.5pt; }
            section { margin-bottom: 14px; }
            h2 { display: flex; align-items: baseline; gap: 8px; margin: 0 0 4px; font-size: 12.5pt; break-after: avoid; }
            h2 small { color: #85837d; font-size: 8.5pt; font-weight: 500; }
            .it { padding: 3px 0 4px 14px; border-bottom: 1px dashed #e5e4df; line-height: 1.65; break-inside: avoid; }
            .q { white-space: pre-line; padding: 0 2px; border-radius: 3px; font-weight: 650; -webkit-box-decoration-break: clone; box-decoration-break: clone; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .m { margin-left: 8px; color: #a3a29b; font-size: 8.5pt; white-space: nowrap; }
            .n { color: #61605a; font-size: 9pt; }
        </style></head><body><header><b>형광펜 모아보기</b><span>${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 · 방 ${groups.length}개 · 문구 ${recs.length}개</span></header>${body}</body></html>`);
        w.document.close();
        setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 500);
    }

    // ── 백업 파일 (되살리기용) ──
    function hpDownloadBackup(items = hp.all, label = '') {
        const data = { kind: 'crack-tuner-highlights', v: 1, exportedAt: new Date().toISOString(), label, settings: hp.settings, items };
        hpDownload(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `형광펜 백업_${hpFileStamp()}.json`);
    }
    function hpPickBackup() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const data = JSON.parse(await file.text());
                const items = (Array.isArray(data?.items) ? data.items : []).filter(r => r && typeof r.id === 'string' && r.text).map(r => ({
                    ...r, id: String(r.id).slice(0, 80), text: String(r.text), note: String(r.note || ''),
                    chatId: RS_ID.test(String(r.chatId || '')) ? String(r.chatId).toLowerCase() : '',
                    color: { bg: hpColor(r.color?.bg), text: r.color?.text ? hpColor(r.color.text, '') : '' }
                }));
                const fresh = items.filter(r => !hp.byId.has(r.id));
                if (fresh.length) await hpPutMany(fresh);
                hp.paintSig = '';
                hpPaint(true);
                hpToast(fresh.length ? `${fresh.length}개를 불러왔어요 (이미 있던 ${items.length - fresh.length}개는 그대로)` : '새로 불러올 형광펜이 없어요');
            } catch (e) {
                hpToast('백업 파일을 읽지 못했어요');
            }
        });
        input.click();
    }

    // ── 시작 · 방 바뀜 ──
    function hpOnPage(routeChanged) {
        if (routeChanged) {
            hp.paintSig = '';
            hp.openId = '';
            hpHidePill();
            hpCloseEdit();
        }
        if (hp.ready && rsChatIdFromPath()) hpSchedulePaint();
    }
    function hpInit() {
        if (hp.started) return;
        hp.started = true;
        hpLoad();
        document.addEventListener('mouseup', hpOnPointerUp, true);
        document.addEventListener('touchend', hpOnPointerUp, true);
        document.addEventListener('selectionchange', hpOnSelectionChange);
        document.addEventListener('click', hpOnDocClick, true);
        document.addEventListener('contextmenu', hpOnContextMenu, true);
        document.addEventListener('scroll', event => {
            if (event.target?.closest?.(HP_UI)) return;
            if (!hp.scrollRaf) hp.scrollRaf = requestAnimationFrame(hpOnScrollFrame);
        }, true);
        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            let handled = true;
            if (document.getElementById('crk-hp-export')?.classList.contains('is-on')) hpCloseExport();
            else if (document.getElementById('crk-hp-migrate')) hpCloseMigrate();
            else if (hp.popId) hpClosePop();
            else if (hp.editId) hpCloseEdit();
            else if (document.getElementById('crk-hp-pill')?.style.display === 'flex') hpHidePill();
            else handled = false;
            if (handled) { event.preventDefault(); event.stopPropagation(); }
        }, true);
        hp.listeners.add(() => {
            hpRenderPanel();
            if (hpL.open) hpRenderLounge();
            if (rs.root && rs.tab !== 'hl') {
                const count = rs.root.querySelector('.crs-hl-count');
                const n = hpRoomRecs(rsChatIdFromPath()).length;
                if (count) count.textContent = n ? String(n) : '';
            }
        });
        document.addEventListener('focusout', event => {
            if (!hp.panelDirty || !event.target?.closest?.('.crs-hl')) return;
            setTimeout(() => { if (!document.activeElement?.closest?.('.crs-hl')) { hp.panelDirty = false; hpRenderPanel(true); } }, 0);
        }, true);
        window.addEventListener('resize', () => { if (hpL.open) hpPlaceLounge(); }, { passive: true });
        window.visualViewport?.addEventListener('resize', () => { if (hpL.open) hpPlaceLounge(); }, { passive: true });
        hpWhenReady(hpTakePendingJump);
    }

    addCrackStyle(`
        body { --crk-glass: rgba(30, 30, 34, .62); --crk-glass-bd: rgba(255, 255, 255, .14); --crk-glass-hi: inset 0 1px 0 rgba(255, 255, 255, .09); --crk-hl-star: #f2c94c; }
        body[data-theme="light"] { --crk-glass: rgba(255, 255, 255, .7); --crk-glass-bd: rgba(255, 255, 255, .8); --crk-glass-hi: inset 0 1px 0 rgba(255, 255, 255, .95), 0 0 0 1px rgba(0, 0, 0, .06); }
        /* 글에 칠한 자리 */
        mark.crk-hl { font-weight: var(--crk-hp-weight, 700); padding: 2px 0; cursor: pointer; transition: background-color .3s, color .3s, opacity .3s; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
        mark.crk-hl.crk-hl-s { border-top-left-radius: 4px; border-bottom-left-radius: 4px; padding-left: 2px; }
        mark.crk-hl.crk-hl-e { border-top-right-radius: 4px; border-bottom-right-radius: 4px; padding-right: 2px; }
        mark.crk-hl:hover { opacity: .82; }
        mark.crk-hl.is-flash { animation: crkHlFlash 1.6s ease; }
        @keyframes crkHlFlash { 0%, 100% { box-shadow: 0 0 0 0 rgba(255, 146, 43, 0); } 30%, 70% { box-shadow: 0 0 0 3px rgba(255, 146, 43, .85); } }
        /* 색 알약 · 고치기 알약 */
        .crk-hp-pill { position: fixed; z-index: 2147482990; display: none; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid var(--crk-glass-bd); border-radius: 999px; background: var(--crk-glass); color: var(--ct-text); box-shadow: 0 10px 28px rgba(0, 0, 0, .35), var(--crk-glass-hi); -webkit-backdrop-filter: blur(18px) saturate(1.6); backdrop-filter: blur(18px) saturate(1.6); font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Segoe UI", sans-serif; font-size: 13px; }
        .crk-hp-pill.is-in { animation: crkPillIn .32s var(--ct-spring) both; }
        @keyframes crkPillIn { from { opacity: 0; transform: translateY(6px) scale(.9); } }
        .crk-hp-pill.is-dock { justify-content: space-between; padding: 8px 10px; border-radius: 18px; }
        .crk-hp-dot { flex: none; width: 24px; height: 24px; padding: 0; border: 2px solid rgba(255, 255, 255, .85); border-radius: 50%; box-shadow: 0 2px 4px rgba(0, 0, 0, .25); cursor: pointer; transition: transform .25s var(--ct-spring), box-shadow .2s; }
        .crk-hp-pill.is-in .crk-hp-dot { animation: crkDotIn .4s var(--ct-spring) both; animation-delay: calc(var(--n, 0) * 45ms + 60ms); }
        @keyframes crkDotIn { from { opacity: 0; transform: scale(.3); } }
        .crk-hp-dot:hover { transform: scale(1.18); }
        .crk-hp-dot.is-on { box-shadow: 0 0 0 2px var(--ct-text), 0 2px 4px rgba(0, 0, 0, .25); }
        .crk-hp-pill.is-dock .crk-hp-dot { width: 30px; height: 30px; }
        .crk-hp-vs { flex: none; width: 1px; height: 18px; margin: 0 2px; background: var(--ct-line2); }
        .crk-hp-ib { display: grid; place-items: center; flex: none; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--ct-muted); cursor: pointer; transition: background-color .14s, color .14s; }
        .crk-hp-ib:hover { background: var(--ct-hover2); color: var(--ct-text); }
        .crk-hp-ib svg { transition: transform .36s var(--ct-spring); }
        .crk-hp-ib:hover svg { transform: translateY(-2px); }
        .crk-hp-del.is-armed, .crs-hl-del.is-armed { background: rgba(229, 83, 75, .16); color: #e5534b; }
        .crk-hp-edit { flex-wrap: wrap; max-width: min(340px, calc(100vw - 16px)); border-radius: 22px; }
        .crk-hp-memo-row { display: flex; align-items: center; gap: 6px; flex: 1 0 100%; padding: 4px 2px 0; }
        .crk-hp-memo-row[hidden] { display: none; }
        .crk-hp-memo { flex: 1; min-width: 0; height: 32px; padding: 0 10px; border: 1px solid var(--ct-line2); border-radius: 10px; outline: 0; background: var(--ct-field); color: var(--ct-text); font: inherit; font-size: 13px; }
        .crk-hp-memo:focus { box-shadow: 0 0 0 3px var(--ct-ring); }
        /* 말한 사람 고르기 */
        .crk-hp-pop { position: fixed; z-index: 2147482995; display: none; width: 250px; padding: 8px; border: 1px solid var(--ct-line2); border-radius: 14px; background: var(--ct-menu); color: var(--ct-text); box-shadow: var(--ct-shadow); font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Segoe UI", sans-serif; font-size: 13px; transform-origin: top left; }
        .crk-hp-pop.is-in { animation: crkPopIn .22s var(--ct-spring); }
        @keyframes crkPopIn { from { opacity: 0; transform: scale(.94) translateY(-4px); } }
        .crk-hp-pop-h { display: flex; align-items: center; gap: 7px; padding: 6px 8px 8px; font-weight: 750; }
        .crk-hp-pop-h svg { color: var(--ct-faint); }
        .crk-hp-who { display: flex; align-items: center; gap: 9px; width: 100%; height: 36px; padding: 0 8px; border: 0; border-radius: 9px; background: transparent; color: var(--ct-text); font: inherit; text-align: left; cursor: pointer; }
        .crk-hp-who:hover, .crk-hp-who.is-on { background: var(--ct-hover2); }
        .crk-hp-who b { font-weight: 680; }
        .crk-hp-who span { flex: 1; font-size: 11.5px; color: var(--ct-faint); }
        .crk-hp-pop-h2 { margin-top: 6px; padding: 10px 8px 6px; border-top: 1px solid var(--ct-line); color: var(--ct-faint); font-size: 11px; font-weight: 600; }
        .crk-hp-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 8px 8px; }
        .crk-hp-chips button { height: 28px; padding: 0 11px; border: 1px solid var(--ct-line); border-radius: 999px; background: transparent; color: var(--ct-muted); font: inherit; font-size: 12px; font-weight: 640; cursor: pointer; }
        .crk-hp-chips button.is-on { border-color: transparent; background: var(--ct-ink); color: var(--ct-ink-fg); }
        .crk-hp-who-row { display: flex; align-items: center; gap: 7px; height: 36px; margin: 4px 4px 2px; padding: 0 10px; border: 1px dashed var(--ct-line2); border-radius: 9px; color: var(--ct-faint); }
        .crk-hp-who-in { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--ct-text); font: inherit; font-size: 13px; }
        /* 알림 */
        #crk-hp-toast { position: fixed; left: 50%; bottom: max(24px, env(safe-area-inset-bottom, 0px)); z-index: 2147483003; display: flex; align-items: center; gap: 12px; max-width: calc(100vw - 32px); min-height: 44px; padding: 0 8px 0 16px; box-sizing: border-box; border-radius: 12px; background: var(--ct-ink); color: var(--ct-ink-fg); box-shadow: var(--ct-shadow); font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Segoe UI", sans-serif; font-size: 13.5px; font-weight: 640; opacity: 0; pointer-events: none; transform: translate(-50%, 8px); transition: opacity .16s, transform .22s var(--ct-ease); }
        #crk-hp-toast.is-on { opacity: 1; pointer-events: auto; transform: translate(-50%, 0); }
        #crk-hp-toast .crk-hp-toast-text { padding: 12px 8px 12px 0; }
        #crk-hp-toast button { height: 30px; padding: 0 10px; flex: none; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 13px; font-weight: 700; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
        @media (max-width: 900px) { #crk-hp-toast { bottom: calc(132px + env(safe-area-inset-bottom, 0px)); } }
        /* 큰 창 (옮기기 · 내보내기) */
        .crk-hp-modal { position: fixed; inset: 0; z-index: 2147482980; display: grid; place-items: center; padding: 16px; background: var(--ct-scrim, rgba(0, 0, 0, .5)); font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Segoe UI", sans-serif; color: var(--ct-text); animation: crkFade .2s both; }
        #crk-hp-export:not(.is-on) { display: none; }
        @keyframes crkFade { from { opacity: 0; } }
        .crk-hp-modal * { box-sizing: border-box; }
        .crk-hp-modal-card { width: min(460px, 100%); max-height: calc(100dvh - 32px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--ct-line2); border-radius: 22px; background: var(--ct-menu); box-shadow: var(--ct-shadow-lg, var(--ct-shadow)); animation: crkModalIn .34s var(--ct-spring) both; }
        @keyframes crkModalIn { from { opacity: 0; transform: translateY(10px) scale(.96); } }
        .crk-hp-modal-head { display: flex; align-items: center; gap: 9px; min-height: 54px; padding: 0 10px 0 20px; }
        .crk-hp-modal-head > svg { color: var(--crk-hl-star); flex: none; }
        .crk-hp-modal-head strong { flex: 1; min-width: 0; font-size: 15.5px; font-weight: 750; }
        .crk-hp-modal-sub { margin: 0; padding: 0 20px 12px; color: var(--ct-muted); font-size: 13px; line-height: 1.55; }
        .crk-hp-modal-note { margin: 0; padding: 0 20px 12px; color: var(--ct-faint); font-size: 12px; line-height: 1.5; }
        .crk-hp-mig-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; margin: 0 12px 12px; padding: 4px; border-radius: 14px; background: var(--ct-sunk); }
        .crk-hp-mig-row { display: flex; align-items: center; gap: 10px; height: 36px; padding: 0 10px; font-size: 13px; }
        .crk-hp-mig-name { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 620; }
        .crk-hp-mig-name.is-faint { color: var(--ct-faint); }
        .crk-hp-mig-row em { font-style: normal; color: var(--ct-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
        .crk-hp-modal-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 16px 16px; border-top: 1px solid var(--ct-line); }
        .crk-hp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 36px; padding: 0 14px; border: 1px solid var(--ct-line2); border-radius: 10px; background: transparent; color: var(--ct-text); font: inherit; font-size: 13px; font-weight: 640; cursor: pointer; white-space: nowrap; transition: background-color .15s; }
        .crk-hp-btn:hover { background: var(--ct-hover2); }
        .crk-hp-btn.is-primary { border-color: transparent; background: var(--ct-ink); color: var(--ct-ink-fg); font-weight: 720; }
        .crk-hp-btn.is-danger { margin-right: auto; color: #e5534b; }
        .crk-hp-btn svg { transition: transform .36s var(--ct-spring); }
        .crk-hp-btn:hover svg { transform: translateY(-2px); }
        .crk-hp-thumb { display: inline-grid; place-items: center; flex: none; overflow: hidden; border-radius: 50%; background: var(--ct-sunk); color: var(--ct-muted); font-weight: 750; }
        .crk-hp-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        /* 「이 방에서 찾기」 탭 셋 */
        #crack-room-search .crs-tabs { grid-template-columns: repeat(3, 1fr); }
        #crack-room-search .crs-tabs > i { width: calc((100% - 6px) / 3); }
        #crack-room-search .crs-tabs button[data-tab="hl"][aria-selected="true"] svg { color: var(--crk-hl-star); }
        #crack-room-search[data-tab="hl"] .crs-bar,
        #crack-room-search[data-tab="hl"] .crs-tools,
        #crack-room-search[data-tab="hl"] .crs-status:not(.is-jump),
        #crack-room-search[data-tab="hl"] .crs-list,
        #crack-room-search[data-tab="hl"] .crs-foot,
        #crack-room-search[data-tab="hl"] .crs-bm-tools,
        #crack-room-search[data-tab="hl"] .crs-bm-list { display: none; }
        #crack-room-search[data-tab="hl"] .crs-status.is-jump { display: flex; }
        #crack-room-search:not([data-tab="hl"]) .crs-hl { display: none; }
        #crack-room-search.is-mobile:not(.is-list) .crs-hl { display: none; }
        #crack-room-search[data-bmscope="all"] .crs-bm-sort { display: none; }
        .crs-hl { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
        .crs-hl-tools { display: flex; align-items: center; gap: 2px; flex: none; padding: 0 10px 10px 16px; }
        .crs-hl-sp { flex: 1; }
        .crs-hl-seg, .crs-bm-scope { position: relative; display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr; padding: 3px; border-radius: 999px; background: var(--ct-sunk); isolation: isolate; }
        .crs-hl-seg > i { position: absolute; z-index: -1; top: 3px; bottom: 3px; left: 3px; width: calc((100% - 6px) / 2); border-radius: 999px; background: var(--ct-knob); box-shadow: 0 1px 3px rgba(0, 0, 0, .14), 0 0 0 1px var(--ct-line); transform: translateX(calc(100% * var(--i, 0))); transition: transform .3s var(--ct-ease); }
        .crs-hl-seg button { display: flex; align-items: center; justify-content: center; gap: 6px; height: 28px; padding: 0 12px; border: 0; background: transparent; color: var(--ct-muted); font: inherit; font-size: 12.5px; font-weight: 650; white-space: nowrap; cursor: pointer; transition: color .18s; }
        .crs-hl-seg button[aria-selected="true"] { color: var(--ct-text); }
        .crs-hl-seg b { color: var(--ct-faint); font-weight: 600; font-variant-numeric: tabular-nums; }
        .crs-bm-scope { margin-right: auto; }
        .crs-bm-tools { flex-wrap: wrap; }
        .crs-hl-ib.is-on { background: var(--ct-hover2); color: var(--ct-text); }
        .crs-hl-ib[data-act="hpgear"]:hover svg { transform: rotate(60deg); }
        .crs-hl-ib[data-act="hpexpand"]:hover svg { transform: scale(1.12); }
        .crs-hl-query { flex: none; padding: 0 16px 10px; animation: crsOpen .2s var(--ct-ease); }
        .crs-hl-q { width: 100%; height: 38px; padding: 0 12px; border: 1px solid var(--ct-line2); border-radius: 12px; outline: 0; background: var(--ct-field); color: var(--ct-text); font: inherit; font-size: 14px; }
        .crs-hl-q:focus { border-color: var(--ct-muted); box-shadow: 0 0 0 3px var(--ct-ring); }
        .crs-hl-colors { display: flex; align-items: center; gap: 8px; flex: none; padding: 0 16px 12px; }
        .crs-hl-dot { width: 20px; height: 20px; padding: 0; border: 2px solid var(--ct-menu); border-radius: 50%; box-shadow: 0 0 0 1px var(--ct-line2); cursor: pointer; transition: transform .25s var(--ct-spring), box-shadow .2s; }
        .crs-hl-dot:hover { transform: scale(1.18); }
        .crs-hl-dot.is-on { box-shadow: 0 0 0 2px var(--ct-text); transform: scale(1.08); }
        .crs-hl-lbl { margin-left: auto; color: var(--ct-faint); font-size: 12px; white-space: nowrap; }
        .crs-hl-lbl.is-busy::before { content: ''; display: inline-block; width: 8px; height: 8px; margin-right: 6px; border: 1.5px solid var(--ct-line2); border-top-color: var(--ct-ink); border-radius: 50%; animation: crsSpin .8s linear infinite; vertical-align: -1px; }
        .crs-hl-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; border-top: 1px solid var(--ct-line); scrollbar-width: thin; }
        #crack-room-search.is-mobile.is-list .crs-hl-list { margin-bottom: 10px; }
        .crs-hl-item { border-bottom: 1px solid var(--ct-line); animation: crkRowIn .32s var(--ct-ease) both; animation-delay: calc(var(--n, 0) * 35ms); }
        @keyframes crkRowIn { from { opacity: 0; transform: translateY(6px); } }
        .crs-hl-item.is-open { background: var(--ct-hover2); }
        .crs-hl-head { display: flex; flex-direction: column; gap: 7px; width: 100%; padding: 12px 16px 12px 20px; border: 0; background: transparent; color: var(--ct-text); font: inherit; text-align: left; cursor: pointer; position: relative; }
        .crs-hl-head::before { content: ''; position: absolute; left: 10px; top: 14px; bottom: 14px; width: 4px; border-radius: 4px; background: var(--c); }
        .crs-hl-text { white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 14px; line-height: 1.6; word-break: keep-all; overflow-wrap: anywhere; }
        .crs-hl-item.is-open .crs-hl-text { -webkit-line-clamp: 6; }
        .crk-hp-ph { font-weight: 600; }
        .crk-hp-ph.is-marked { padding: 1px 2px; border-radius: 4px; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
        .crs-hl-memo { display: flex; align-items: flex-start; gap: 6px; color: var(--ct-muted); font-size: 12.5px; line-height: 1.45; }
        .crs-hl-memo svg { flex: none; margin-top: 2px; color: var(--ct-faint); }
        .crs-hl-acts { display: flex; align-items: center; gap: 6px; padding: 0 12px 12px 20px; animation: crsOpen .2s var(--ct-ease); }
        .crs-hl-mini { display: inline-flex; align-items: center; gap: 5px; padding: 0 4px; }
        .crs-hl-mini button { width: 16px; height: 16px; padding: 0; border: 0; border-radius: 50%; box-shadow: 0 0 0 1px var(--ct-line2); cursor: pointer; transition: transform .2s var(--ct-spring); }
        .crs-hl-mini button:hover { transform: scale(1.2); }
        .crs-hl-mini button.is-on { box-shadow: 0 0 0 2px var(--ct-text); }
        .crs-hl-acts .crs-icon { width: 30px; height: 30px; flex-basis: 30px; }
        .crs-hl-del { margin-left: auto; }
        .crs-hl-memo-edit { padding: 0 16px 12px 20px; }
        .crs-hl-memo-in { width: 100%; height: 36px; padding: 0 12px; border: 1px solid var(--ct-line2); border-radius: 10px; outline: 0; background: var(--ct-field); color: var(--ct-text); font: inherit; font-size: 13.5px; }
        .crs-hl-memo-in:focus { box-shadow: 0 0 0 3px var(--ct-ring); }
        .crs-hl-grp { border-bottom: 1px solid var(--ct-line); animation: crkRowIn .32s var(--ct-ease) both; animation-delay: calc(var(--n, 0) * 45ms); }
        .crs-hl-gh { display: flex; align-items: center; gap: 10px; width: 100%; padding: 11px 12px 11px 16px; border: 0; background: transparent; color: var(--ct-text); font: inherit; text-align: left; cursor: pointer; }
        .crs-hl-gh:not(.is-static):hover { background: var(--ct-hover2); }
        .crs-hl-gh.is-static { cursor: default; }
        .crs-hl-gname { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .crs-hl-gname b { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 14px; font-weight: 720; }
        .crs-hl-gname span { color: var(--ct-faint); font-size: 12px; }
        .crs-hl-here { padding: 2px 7px; border-radius: 999px; background: var(--ct-ink); color: var(--ct-ink-fg); font-size: 11px; font-weight: 700; white-space: nowrap; }
        .crs-hl-gdots { display: inline-flex; gap: 3px; }
        .crs-hl-gdots i { width: 8px; height: 8px; border-radius: 50%; }
        .crs-hl-num { min-width: 20px; text-align: right; color: var(--ct-muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
        .crs-hl-chev { display: grid; color: var(--ct-faint); transition: transform .3s var(--ct-ease); }
        .crs-hl-grp.is-open .crs-hl-chev { transform: rotate(180deg); }
        .crs-hl-gbody { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .3s var(--ct-ease); }
        .crs-hl-grp.is-open .crs-hl-gbody { grid-template-rows: 1fr; }
        .crs-hl-gbody > div { overflow: hidden; }
        .crs-hl-c { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 16px 7px 56px; border: 0; background: transparent; color: var(--ct-text); font: inherit; font-size: 13.5px; text-align: left; cursor: pointer; animation: crkRowIn .3s var(--ct-ease) both; animation-delay: calc(var(--n, 0) * 25ms); }
        .crs-hl-list > .crs-hl-c { padding-left: 16px; }
        .crs-hl-c:hover, .crs-hl-c.is-current { background: var(--ct-hover2); }
        .crs-hl-gbody .crs-hl-c:last-child { padding-bottom: 12px; }
        .crs-hl-cdot { flex: none; width: 9px; height: 9px; border-radius: 50%; }
        .crs-hl-star { display: grid; flex: none; color: var(--crs-star); }
        .crs-hl-ctext { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .crs-hl-cnote { color: var(--ct-faint); }
        .crs-hl-cturn { flex: none; color: var(--ct-faint); font-size: 11.5px; font-variant-numeric: tabular-nums; }
        .crs-hl-pop { position: absolute; z-index: 5; top: 44px; right: 10px; width: 250px; padding: 10px; border: 1px solid var(--ct-line2); border-radius: 14px; background: var(--ct-menu); box-shadow: var(--ct-shadow); animation: crkPopIn .22s var(--ct-spring); transform-origin: top right; font-size: 13px; }
        .crs-hl-pop-h { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-weight: 750; }
        .crs-hl-pop ol { margin: 0; padding-left: 18px; color: var(--ct-muted); line-height: 1.6; }
        .crs-hl-set-row { display: flex; align-items: center; gap: 10px; height: 34px; color: var(--ct-muted); }
        .crs-hl-set-ic { display: grid; color: var(--ct-faint); }
        .crs-hl-set-lbl { flex: 1; }
        .crs-hl-op { width: 104px; accent-color: var(--ct-ink); }
        .crs-hl-sw { width: 34px; height: 20px; padding: 2px; border: 0; border-radius: 999px; background: var(--ct-sunk); cursor: pointer; transition: background-color .2s; }
        .crs-hl-sw i { display: block; width: 16px; height: 16px; border-radius: 50%; background: var(--ct-knob); box-shadow: 0 1px 3px rgba(0, 0, 0, .25); transition: transform .26s var(--ct-spring); }
        .crs-hl-sw.is-on { background: var(--ct-ink); }
        .crs-hl-sw.is-on i { transform: translateX(14px); background: var(--ct-ink-fg); }
        .crs-hl-set-h { margin: 6px 0 4px; color: var(--ct-faint); font-size: 11.5px; font-weight: 600; }
        .crs-hl-pal { display: flex; flex-wrap: wrap; gap: 7px; padding-bottom: 4px; }
        .crs-hl-pal-dot { width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; box-shadow: 0 0 0 1px var(--ct-line2); cursor: pointer; }
        .crs-hl-pal-dot.is-armed { box-shadow: 0 0 0 2px #e5534b; }
        .crs-hl-pal-add { position: relative; display: grid; place-items: center; width: 22px; height: 22px; border: 1px dashed var(--ct-faint); border-radius: 50%; color: var(--ct-faint); cursor: pointer; transition: transform .3s var(--ct-spring); }
        .crs-hl-pal-add:hover { transform: rotate(90deg); }
        .crs-hl-pal-add input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
        .crs-hl-set hr { margin: 6px 0; border: 0; border-top: 1px solid var(--ct-line); }
        .crs-hl-set-btn { display: flex; align-items: center; gap: 10px; width: 100%; height: 34px; padding: 0 2px; border: 0; background: transparent; color: var(--ct-muted); font: inherit; text-align: left; cursor: pointer; }
        .crs-hl-set-btn:hover { color: var(--ct-text); }
        .crs-hl-set-btn svg { color: var(--ct-faint); }
        .crs-hl-set-btn.is-danger, .crs-hl-set-btn.is-danger svg { color: #e5534b; }
        #crack-room-search.is-mobile .crs-hl-tools { padding: 0 6px 8px 14px; }
        #crack-room-search.is-mobile .crs-hl-colors { padding: 0 14px 10px; }
        #crack-room-search.is-mobile .crs-hl-seg button { height: 32px; }
        #crack-room-search.is-mobile .crs-hl-ib[data-act="hpquery"] { display: none; }
        /* 펼쳐보기 (형광펜 모아보기) */
        #crk-hp-lounge { position: fixed; right: 0; bottom: 0; z-index: 9996; display: grid; grid-template-rows: auto auto minmax(0, 1fr); box-sizing: border-box; background: var(--ct-canvas); color: var(--ct-text); border-left: 1px solid var(--ct-line); font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Segoe UI", sans-serif; font-size: 14px; container-type: inline-size; clip-path: inset(0 calc(100% - var(--crack-lg-from, 260px)) 0 0); opacity: 0; visibility: hidden; pointer-events: none; transition: clip-path 380ms var(--ct-ease), opacity 220ms 120ms, visibility 0s 400ms; }
        #crk-hp-lounge.is-open { clip-path: inset(0 0 0 0); opacity: 1; visibility: visible; pointer-events: auto; transition: clip-path 520ms var(--ct-ease), opacity 140ms, visibility 0s; }
        #crk-hp-lounge * { box-sizing: border-box; }
        #crk-hp-lounge.is-mobile { border: 0; clip-path: none; transform: translateY(16px); transition: transform 240ms var(--ct-ease), opacity 180ms, visibility 0s 240ms; padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); }
        #crk-hp-lounge.is-mobile.is-open { transform: none; transition-delay: 0s; }
        .crk-hpl-top { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 12px; padding: 12px 16px; border-bottom: 1px solid var(--ct-line); background: var(--ct-bg); }
        .crk-hpl-close { display: grid; place-items: center; width: 36px; height: 36px; flex: none; padding: 0; border: 0; border-radius: 11px; background: var(--ct-field); color: var(--ct-text); cursor: pointer; }
        .crk-hpl-close svg { transition: transform .36s var(--ct-spring); }
        .crk-hpl-close:hover svg { transform: translateX(-2px); }
        .crk-hpl-heading { display: flex; align-items: baseline; gap: 8px; }
        .crk-hpl-heading strong { font-size: 17px; font-weight: 780; letter-spacing: -.025em; white-space: nowrap; }
        .crk-hpl-heading em { font-style: normal; font-size: 12px; color: var(--ct-faint); white-space: nowrap; }
        .crk-hpl-search { display: flex; align-items: center; gap: 8px; flex: 1 1 160px; max-width: 280px; height: 36px; padding: 0 11px; border-radius: 11px; background: var(--ct-field); color: var(--ct-faint); }
        .crk-hpl-search:focus-within { background: var(--ct-raise); box-shadow: 0 0 0 1px var(--ct-line2), 0 0 0 4px var(--ct-ring); }
        .crk-hpl-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--ct-text); font: inherit; font-size: 13px; }
        .crk-hpl-search input::-webkit-search-cancel-button { display: none; }
        .crk-hpl-colors { display: flex; align-items: center; gap: 9px; padding: 3px 10px 3px 3px; border-radius: 999px; background: var(--ct-sunk); }
        .crk-hpl-cf { flex: none; width: 16px; height: 16px; padding: 0; border: 0; border-radius: 50%; background: var(--d); cursor: pointer; outline: 2px solid transparent; outline-offset: 0; transition: outline-color .16s, outline-offset .26s var(--ct-spring), transform .2s var(--ct-spring); }
        .crk-hpl-cf:not(.is-all) { animation: crkDotIn .4s var(--ct-spring) both; animation-delay: calc(200ms + var(--n, 0) * 40ms); }
        .crk-hpl-cf:hover { transform: scale(1.15); }
        .crk-hpl-cf.is-on { outline-color: var(--d); outline-offset: 2px; }
        .crk-hpl-cf.is-all { width: auto; height: 26px; padding: 0 11px; border-radius: 999px; background: transparent; color: var(--ct-muted); font: inherit; font-size: 11.5px; font-weight: 680; white-space: nowrap; outline: 0; }
        .crk-hpl-cf.is-all.is-on { background: var(--ct-knob); color: var(--ct-text); box-shadow: 0 0 0 1px var(--ct-line); }
        .crk-hpl-tools { display: flex; align-items: center; gap: 6px; margin-left: auto; }
        .crk-hpl-seg { position: relative; display: grid; grid-template-columns: 1fr 1fr; padding: 3px; border-radius: 10px; background: var(--ct-sunk); isolation: isolate; }
        .crk-hpl-seg > i { position: absolute; z-index: -1; top: 3px; bottom: 3px; left: 3px; width: calc((100% - 6px) / 2); border-radius: 7px; background: var(--ct-knob); box-shadow: 0 1px 3px rgba(0, 0, 0, .14), 0 0 0 1px var(--ct-line); transform: translateX(calc(100% * var(--i, 0))); transition: transform .3s var(--ct-ease); }
        .crk-hpl-seg button { height: 28px; padding: 0 11px; border: 0; background: transparent; color: var(--ct-muted); font: inherit; font-size: 12px; font-weight: 640; white-space: nowrap; cursor: pointer; transition: color .18s; }
        .crk-hpl-seg button[aria-pressed="true"] { color: var(--ct-text); }
        .crk-hpl-qa { display: flex; gap: 4px; padding: 3px; border-radius: 10px; background: var(--ct-sunk); }
        .crk-hpl-qa button { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 7px; background: transparent; color: var(--ct-muted); cursor: pointer; transition: background-color .15s, color .15s; }
        .crk-hpl-qa button:hover { background: var(--ct-hover2); color: var(--ct-text); }
        .crk-hpl-qa button.is-on { background: var(--ct-knob); color: var(--ct-text); box-shadow: 0 1px 3px rgba(0, 0, 0, .14), 0 0 0 1px var(--ct-line); }
        .crk-hpl-qa button svg { transition: transform .36s var(--ct-spring); }
        .crk-hpl-qa button:hover svg { transform: translateY(-2px); }
        .crk-hpl-selbar { display: none; align-items: center; gap: 6px; padding: 8px 16px; border-bottom: 1px solid var(--ct-line); background: var(--ct-bg); font-size: 12.5px; }
        #crk-hp-lounge.is-selecting .crk-hpl-selbar { display: flex; animation: crsOpen .2s var(--ct-ease); }
        .crk-hpl-selbar button { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border: 0; border-radius: 8px; background: var(--ct-field); color: var(--ct-text); font: inherit; font-size: 12.5px; font-weight: 640; cursor: pointer; }
        .crk-hpl-selbar button.is-primary { background: var(--ct-ink); color: var(--ct-ink-fg); }
        .crk-hpl-selcount { margin: 0 auto 0 4px; color: var(--ct-muted); font-variant-numeric: tabular-nums; }
        .crk-hpl-body { display: grid; grid-template-columns: 196px minmax(0, 1fr); min-height: 0; }
        .crk-hpl-rail { display: flex; flex-direction: column; gap: 2px; padding: 12px 8px; overflow-y: auto; border-right: 1px solid var(--ct-line); background: var(--ct-bg); scrollbar-width: thin; }
        .crk-hpl-rb { display: flex; align-items: center; gap: 9px; width: 100%; height: 36px; flex: none; padding: 0 10px; border: 0; border-radius: 9px; background: transparent; color: var(--ct-muted); font: inherit; font-size: 12.5px; font-weight: 620; text-align: left; cursor: pointer; transition: background-color .16s, color .16s; }
        .crk-hpl-rb:hover { background: var(--ct-hover); color: var(--ct-text); }
        .crk-hpl-rb.is-on { background: var(--ct-current); color: var(--ct-text); }
        .crk-hpl-rb-ic { display: grid; color: var(--ct-faint); }
        .crk-hpl-rb i { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-style: normal; }
        .crk-hpl-rb em { font-style: normal; color: var(--ct-faint); font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
        .crk-hpl-rh { margin: 14px 10px 6px; color: var(--ct-faint); font-size: 11px; font-weight: 600; }
        .crk-hpl-scroll { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 22px 28px 56px; scrollbar-width: thin; }
        .crk-hpl-status:not(:empty) { margin: 0 2px 14px; color: var(--ct-faint); font-size: 11.5px; }
        .crk-hpl-empty { padding: 60px 20px; color: var(--ct-faint); font-size: 13px; text-align: center; }
        /* 카드 1 「책 밑줄」 */
        .crk-bk-group + .crk-bk-group { margin-top: 30px; }
        .crk-bk-gh { display: flex; align-items: center; gap: 12px; margin-bottom: 2px; padding: 0 0 12px; border-bottom: 1.5px solid var(--ct-text); animation: crkRowIn .3s var(--ct-ease) both .1s; }
        .crk-bk-gh.is-single { border-bottom: 1px solid var(--ct-line2); }
        .crk-bk-t { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .crk-bk-t strong { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 19px; font-weight: 800; letter-spacing: -.025em; }
        .crk-bk-gh.is-single strong { font-size: 15px; color: var(--ct-muted); }
        .crk-bk-t span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--ct-faint); font-size: 11.5px; letter-spacing: .02em; }
        .crk-bk-sp { flex: 1; }
        .crk-bk-gh em { min-width: 34px; text-align: right; font-style: normal; font-size: 28px; line-height: 1; font-weight: 800; color: var(--ct-line2); font-variant-numeric: tabular-nums; }
        .crk-bk-cols { columns: 2; column-gap: 36px; }
        .crk-bk { position: relative; break-inside: avoid; padding: 16px 0 15px; border-bottom: 1px solid var(--ct-line); animation: crkRowIn .34s var(--ct-ease) both; animation-delay: calc(140ms + var(--n, 0) * 30ms); }
        .crk-bk-meta { display: flex; align-items: center; gap: 7px; min-height: 22px; margin-bottom: 6px; color: var(--ct-faint); font-size: 11px; letter-spacing: .03em; }
        .crk-bk-meta > i { flex: none; width: 16px; height: 4px; border-radius: 2px; background: var(--c); }
        .crk-bk-meta b { color: var(--ct-muted); font-weight: 700; }
        .crk-bk-miss { color: #e5534b; }
        .crk-bk-acts { display: flex; gap: 2px; margin-left: auto; opacity: 0; transform: translateX(4px); transition: opacity .16s, transform .24s var(--ct-ease); }
        .crk-bk:hover .crk-bk-acts, .crk-bk:focus-within .crk-bk-acts, #crk-hp-lounge.is-mobile .crk-bk-acts { opacity: 1; transform: none; }
        #crk-hp-lounge.is-selecting .crk-bk-acts { display: none; }
        .crk-bk-q { white-space: pre-line; font-size: 15.5px; line-height: 1.85; letter-spacing: -.005em; word-break: keep-all; overflow-wrap: anywhere; }
        .crk-bk-q .crk-hp-ph { font-weight: 500; }
        .crk-bk-who { display: block; margin: 6px 0 0 auto; padding: 2px 6px; border: 0; border-radius: 6px; background: transparent; color: var(--ct-muted); font: inherit; font-size: 12.5px; font-style: italic; text-align: right; cursor: text; transition: background-color .15s, color .15s; }
        .crk-bk-who:hover { background: var(--ct-hover2); color: var(--ct-text); }
        .crk-bk-who.is-empty { opacity: 0; font-style: normal; }
        .crk-bk:hover .crk-bk-who.is-empty, .crk-bk:focus-within .crk-bk-who.is-empty, #crk-hp-lounge.is-mobile .crk-bk-who.is-empty { opacity: .7; }
        .crk-bk-who-in { display: block; width: min(220px, 100%); height: 30px; margin: 6px 0 0 auto; padding: 0 10px; border: 1px solid var(--ct-line2); border-radius: 8px; outline: 0; background: var(--ct-field); color: var(--ct-text); font: inherit; font-size: 13px; text-align: right; animation: crkPopIn .2s var(--ct-spring); }
        .crk-bk-who-in:focus { box-shadow: 0 0 0 3px var(--ct-ring); }
        .crk-bk-note { margin-top: 9px; padding-left: 10px; border-left: 2px solid var(--c); color: var(--ct-muted); font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; }
        #crk-hp-lounge.is-selecting .crk-bk { padding-left: 32px; cursor: pointer; }
        .crk-bk-pick { position: absolute; left: 0; top: 18px; display: grid; place-items: center; width: 20px; height: 20px; padding: 0; border: 1.5px solid var(--ct-faint); border-radius: 6px; background: transparent; color: var(--ct-ink-fg); cursor: pointer; }
        .crk-bk.is-picked .crk-bk-pick { border-color: var(--ct-ink); background: var(--ct-ink); }
        @container (max-width: 700px) {
            .crk-hpl-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
            .crk-hpl-rail { flex-direction: row; gap: 4px; padding: 6px 8px; overflow-x: auto; overflow-y: hidden; border-right: 0; border-bottom: 1px solid var(--ct-line); }
            .crk-hpl-rb { width: auto; max-width: 220px; }
            .crk-hpl-rh { display: none; }
            .crk-bk-cols { columns: 1; }
            .crk-hpl-scroll { padding: 16px 16px 24px; }
        }
        #crk-hp-lounge.is-mobile .crk-hpl-top { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; grid-template-areas: "c h q" "s s s" "f f g"; gap: 8px; padding: 8px 10px 10px; }
        #crk-hp-lounge.is-mobile .crk-hpl-tools { display: contents; }
        #crk-hp-lounge.is-mobile .crk-hpl-close { grid-area: c; width: 40px; height: 40px; }
        #crk-hp-lounge.is-mobile .crk-hpl-heading { grid-area: h; flex-direction: column; gap: 0; }
        #crk-hp-lounge.is-mobile .crk-hpl-qa { grid-area: q; }
        #crk-hp-lounge.is-mobile .crk-hpl-qa button { width: 38px; height: 36px; }
        #crk-hp-lounge.is-mobile .crk-hpl-search { grid-area: s; max-width: none; height: 42px; }
        #crk-hp-lounge.is-mobile .crk-hpl-search input { font-size: 16px; }
        #crk-hp-lounge.is-mobile .crk-hpl-colors { grid-area: f; justify-self: start; }
        #crk-hp-lounge.is-mobile .crk-hpl-cf:not(.is-all) { width: 22px; height: 22px; }
        #crk-hp-lounge.is-mobile .crk-hpl-seg { grid-area: g; }
        #crk-hp-lounge.is-mobile .crk-hpl-seg button { height: 34px; }
        #crk-hp-lounge.is-mobile .crk-bk-gh .crk-hp-ib { display: none; }
        #crk-hp-lounge.is-mobile .crk-bk-gh em { font-size: 22px; }
        /* 내보내기 창 */
        .crk-hpx { width: min(780px, 100%); }
        .crk-hpx-src { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 40%; color: var(--ct-faint); font-size: 12px; }
        .crk-hpx-body { display: grid; grid-template-columns: minmax(0, 1fr) 300px; min-height: 0; overflow: auto; border-top: 1px solid var(--ct-line); }
        .crk-hpx-prev { display: grid; place-items: center; min-height: 380px; padding: 24px; background: repeating-conic-gradient(var(--ct-sunk) 0 25%, transparent 0 50%) 0 0 / 18px 18px; overflow: auto; }
        .crk-hpx-canvas.is-still { animation: none; }
        .crk-hpx-note { margin: 10px 0 0; color: var(--ct-faint); font-size: 12px; text-align: center; }
        .crk-hpx-canvas { width: min(360px, 100%); height: auto; max-height: 60vh; object-fit: contain; filter: drop-shadow(0 14px 28px rgba(0, 0, 0, .3)); animation: crkPopIn .3s var(--ct-spring); }
        .crk-hpx-side { display: flex; flex-direction: column; gap: 16px; padding: 18px; border-left: 1px solid var(--ct-line); }
        .crk-hpx-row { display: flex; gap: 10px; align-items: flex-start; }
        .crk-hpx-lbl { display: grid; place-items: center; flex: none; width: 28px; height: 28px; border-radius: 8px; background: var(--ct-sunk); color: var(--ct-faint); }
        .crk-hpx-styles { display: flex; gap: 8px; }
        .crk-hpx-st { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 6px; border: 1px solid var(--ct-line); border-radius: 12px; background: transparent; color: var(--ct-muted); font: inherit; font-size: 11.5px; cursor: pointer; transition: transform .24s var(--ct-spring), border-color .18s, color .18s; }
        .crk-hpx-st:hover { transform: translateY(-2px); }
        .crk-hpx-st.is-on { border-color: var(--ct-text); color: var(--ct-text); }
        .crk-hpx-st i { font-style: normal; font-weight: 650; }
        .crk-hpx-mini { position: relative; display: block; width: 58px; height: 40px; overflow: hidden; border-radius: 7px; }
        .crk-hpx-mini.is-hl { background: #fbfaf6; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .06); }
        .crk-hpx-mini.is-hl::after { content: ''; position: absolute; left: 8px; right: 12px; top: 12px; height: 8px; border-radius: 4px; background: rgba(255, 224, 102, .95); box-shadow: 0 12px 0 -1px rgba(0, 0, 0, .14); }
        .crk-hpx-mini.is-quote { background: #1d1c1a; }
        .crk-hpx-mini.is-quote::before { content: '“'; position: absolute; left: 6px; top: -7px; color: #ffe066; font: 700 28px Georgia, serif; }
        .crk-hpx-mini.is-quote::after { content: ''; position: absolute; left: 10px; right: 12px; top: 23px; height: 4px; border-radius: 3px; background: rgba(255, 255, 255, .75); box-shadow: 0 7px 0 rgba(255, 255, 255, .35); }
        .crk-hpx-mini.is-memo { background: #fff3b0; transform: rotate(-2deg) scale(.92); box-shadow: 0 3px 6px rgba(0, 0, 0, .2); }
        .crk-hpx-mini.is-memo::after { content: ''; position: absolute; left: 8px; right: 12px; top: 15px; height: 4px; border-radius: 3px; background: rgba(60, 45, 0, .45); box-shadow: 0 7px 0 rgba(60, 45, 0, .25); }
        .crk-hpx-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .crk-hpx-chips button { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px; border: 1px solid var(--ct-line); border-radius: 999px; background: transparent; color: var(--ct-muted); font: inherit; font-size: 12px; font-weight: 640; cursor: pointer; transition: background-color .16s, color .16s; }
        .crk-hpx-chips button svg { width: 13px; height: 13px; }
        .crk-hpx-chips button.is-on { border-color: transparent; background: var(--ct-ink); color: var(--ct-ink-fg); }
        .crk-hpx-size { display: flex; flex: 1; align-items: center; gap: 9px; min-width: 0; height: 28px; color: var(--ct-muted); }
        .crk-hpx-size input { flex: 1; min-width: 0; margin: 0; accent-color: var(--ct-ink); cursor: pointer; }
        .crk-hpx-ga { font-weight: 700; line-height: 1; text-box: trim-both cap alphabetic; }
        .crk-hpx-ga.is-s { font-size: 11px; }
        .crk-hpx-ga.is-l { font-size: 17px; }
        .crk-hpx-ga.is-lbl { font-size: 13px; }
        .crk-hpx-size-v { width: 38px; color: var(--ct-text); font-size: 12px; font-variant-numeric: tabular-nums; text-align: right; }
        .crk-hpx-bg { display: flex; gap: 10px; padding-top: 1px; }
        .crk-hpx-bg button { width: 26px; height: 26px; padding: 0; border: 0; border-radius: 50%; box-shadow: 0 0 0 1px var(--ct-line2); cursor: pointer; }
        .crk-hpx-bg button.is-on { box-shadow: 0 0 0 2px var(--ct-menu), 0 0 0 4px var(--ct-text); }
        .crk-hpx-bg button.is-clear { background: repeating-conic-gradient(#bbb 0 25%, #fff 0 50%) 0 0 / 10px 10px; }
        .crk-hpx-btns { display: flex; flex-direction: column; gap: 8px; margin-top: auto; }
        .crk-hpx-btns .crk-hp-btn { height: 40px; }
        .crk-hpx.is-sheet { align-self: end; width: 100%; max-height: 92dvh; border-radius: 22px 22px 0 0; animation: crkSheetIn .34s var(--ct-ease) both; }
        @keyframes crkSheetIn { from { opacity: 0; transform: translateY(40px); } }
        .crk-hpx.is-sheet .crk-hpx-body { grid-template-columns: 1fr; }
        .crk-hpx.is-sheet .crk-hpx-prev { min-height: 0; padding: 16px; }
        .crk-hpx.is-sheet .crk-hpx-side { gap: 12px; padding: 14px 14px 18px; border-left: 0; border-top: 1px solid var(--ct-line); }
        .crk-hpx.is-sheet .crk-hpx-btns { flex-direction: row; }
        .crk-hpx.is-sheet .crk-hpx-btns .crk-hp-btn { flex: 1; height: 44px; padding: 0 6px; font-size: 12.5px; }
        .crk-hpx.is-sheet .crk-hpx-src { display: none; }
        #crk-hp-export:has(.is-sheet) { padding: 0; align-items: end; }
        @media (prefers-reduced-motion: reduce) {
            .crk-hp-pill, .crk-hp-pill *, .crk-hp-pop, .crk-hp-modal, .crk-hp-modal *, #crk-hp-lounge, #crk-hp-lounge *, .crs-hl * { animation: none !important; transition: none !important; }
        }
    `);

    function init() {
        if (tunerUiStarted || !document.body) return;
        tunerUiStarted = true;
        installUiPlusInteractionGuard();
        loadArchiveSearchCache();
        cleanupLegacySearchModeArtifacts(true);
        applySavedArchiveHeightFast();
        window.addEventListener('resize', scheduleSearchOverlayPositionUpdate, { passive: true });
        window.addEventListener('scroll', scheduleSearchOverlayPositionUpdate, { capture: true, passive: true });
        document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleUpdate(); });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-theme'] });
        scheduleUpdate();
        initRoomSearch();
        setInterval(() => ensureArchiveCount(false), 60000);
    }
    // Authentication capture stays at document-start; visible DOM work waits for page load.
    const startUi = () => requestAnimationFrame(() => requestAnimationFrame(init));
    if (document.readyState === 'complete') startUi();
    else window.addEventListener('load', startUi, { once: true });
})();
