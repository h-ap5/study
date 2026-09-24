// ==UserScript==
// @name        크랙 대화 프로필 매니저
// @namespace   crack-profile-library-menu
// @version     1.7.2
// @description 대화 프로필 라이브러리, 백업, 전용 메모장 추가.
// @match       https://crack.wrtn.ai/*
// @run-at      document-start
// @grant       none
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'ctm_profile_library_v2';
    const SLOT_MEMO_KEY = 'ctm_profile_slot_memos_v2';
    const LEGACY_PROFILE_KEY = 'crack_integrated_profiles';
    const MIGRATION_LEDGER_KEY = 'ctm_archive_profile_migration_v1';
    const PROFILE_API_BASE = 'https://crack-api.wrtn.ai/crack-api';
    const CHAT_API_BASE = 'https://crack-api.wrtn.ai/crack-gen';
    const REQUEST_TIMEOUT_MS = 15_000;
    const NAME_MAX = 12;
    const INFO_MAX = 500;
    // 크랙이 모바일 배치로 바뀌는 폭. 이하에서는 아래에서 올라오는 시트에 목록 → 편집 두 단계 화면을 쓴다.
    const SHEET_QUERY = '(max-width: 767px)';
    const PROFILE_DIALOG_TITLE = '대화 프로필';
    const DEFAULT_SERVER_SORT = 'updated-desc';
    const SERVER_SORT_OPTIONS = [
        { value: 'updated-desc', label: '최근 수정순', field: 'updatedAt', direction: -1 },
        { value: 'updated-asc', label: '오래된 수정순', field: 'updatedAt', direction: 1 },
        { value: 'created-desc', label: '최근 만든 순', field: 'createdAt', direction: -1 },
        { value: 'created-asc', label: '먼저 만든 순', field: 'createdAt', direction: 1 },
        { value: 'name', label: '이름순' },
    ];
    const LIBRARY_SORT_OPTIONS = [
        { value: 'saved', label: '최근 추가순' },
        { value: 'name', label: '이름순' },
    ];

    const UI = {
        rootId: 'ctmProfileLibraryRoot',
        styleId: 'ctmProfileLibraryStyle',
        entryId: 'ctm-profile-manager-btn',
    };

    function loadLibrary() {
        try {
            const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
            return Array.isArray(data) ? data : [];
        } catch { return []; }
    }
    function saveLibrary(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    function loadSlotMemos() {
        try { return JSON.parse(localStorage.getItem(SLOT_MEMO_KEY)) || {}; } catch { return {}; }
    }
    function saveSlotMemos(data) { localStorage.setItem(SLOT_MEMO_KEY, JSON.stringify(data)); }

    // Import the other archive once per source record. Keep its data intact so the
    // original script can be disabled without losing any saved profiles.
    function migrateLegacyProfiles() {
        try {
            const rawLegacy = localStorage.getItem(LEGACY_PROFILE_KEY);
            if (!rawLegacy) return;
            const legacy = JSON.parse(rawLegacy);
            if (!Array.isArray(legacy)) return;

            // A damaged manager store must not be replaced with a new array.
            const rawLibrary = localStorage.getItem(STORAGE_KEY);
            if (rawLibrary !== null && !Array.isArray(JSON.parse(rawLibrary))) return;

            const rawLedger = localStorage.getItem(MIGRATION_LEDGER_KEY);
            const parsedLedger = rawLedger === null ? {} : JSON.parse(rawLedger);
            if (!parsedLedger || typeof parsedLedger !== 'object' || Array.isArray(parsedLedger)) return;

            const ledger = { ...parsedLedger };
            const library = loadLibrary();
            const usedIds = new Set(library.map((item) => String(item.id)));
            const repeatedIds = new Map();
            const claimedNoIdTargets = new Set(Object.entries(ledger)
                .filter(([key]) => key.startsWith('["id",'))
                .map(([, targetId]) => String(targetId)));
            let changed = false;

            legacy.forEach((item, index) => {
                if (!item || typeof item !== 'object' || Array.isArray(item)) return;
                const name = String(item.name ?? '');
                const information = String(item.desc ?? '');
                if (!name && !information) return;

                const sourceId = item.id == null ? '' : String(item.id);
                const occurrence = repeatedIds.get(sourceId) || 0;
                repeatedIds.set(sourceId, occurrence + 1);
                const sourceKey = sourceId
                    ? JSON.stringify(['id', sourceId, occurrence])
                    : JSON.stringify(['no-id', index, name, information]);
                if (Object.hasOwn(ledger, sourceKey)) return;

                // Also recover if the library write succeeded but the ledger write did not.
                const alreadyImported = library.find((saved) => saved.archiveSourceKey === sourceKey);
                if (alreadyImported) {
                    ledger[sourceKey] = String(alreadyImported.id);
                    changed = true;
                    return;
                }

                // The old archive assigns an ID to older ID-less records on read.
                // Match the previously imported copy before treating that new ID
                // as a new profile. The ledger also remembers entries intentionally
                // deleted from this manager, so they do not reappear after ID assignment.
                if (sourceId) {
                    const formerNoId = Object.entries(ledger).find(([key, targetId]) => {
                        if (claimedNoIdTargets.has(String(targetId))) return false;
                        try {
                            const source = JSON.parse(key);
                            return source?.[0] === 'no-id' && source[2] === name && source[3] === information;
                        } catch { return false; }
                    });
                    if (formerNoId) {
                        const [noIdKey, targetId] = formerNoId;
                        ledger[sourceKey] = String(targetId);
                        const importedCopy = library.find((saved) => saved.archiveSourceKey === noIdKey && String(saved.id) === String(targetId));
                        if (importedCopy) importedCopy.archiveSourceId = sourceId;
                        claimedNoIdTargets.add(String(targetId));
                        changed = true;
                        return;
                    }
                }

                let id = sourceId;
                if (!id || usedIds.has(id)) {
                    do {
                        id = `archive_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
                    } while (usedIds.has(id));
                }
                usedIds.add(id);
                library.push({ id, name, information, memo: '', archiveSourceKey: sourceKey,
                    ...(sourceId && id !== sourceId ? { archiveSourceId: sourceId } : {}) });
                ledger[sourceKey] = id;
                changed = true;
            });

            if (changed) {
                saveLibrary(library);
                localStorage.setItem(MIGRATION_LEDGER_KEY, JSON.stringify(ledger));
            }
        } catch (error) {
            console.warn('[크랙 대화 프로필 매니저] 보관함 데이터 이전 실패:', error);
        }
    }

    let capturedToken = null;

    function requestUrl(input) {
        try { return new URL(input instanceof URL || typeof input === 'string' ? input : input?.url, location.href); }
        catch { return null; }
    }

    function isWrtnUrl(url) { return !!url && (url.hostname === 'wrtn.ai' || url.hostname.endsWith('.wrtn.ai')); }

    function captureAuthorization(headers, url) {
        if (!isWrtnUrl(url) || !headers) return;
        try {
            const value = new Headers(headers).get('authorization');
            if (value?.startsWith('Bearer ')) capturedToken = value;
        } catch { /* Ignore malformed headers from unrelated requests. */ }
    }

    // Capture the bearer token before the application starts. Requests use the
    // access_token cookie first and fall back to this token.
    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
        captureAuthorization(init?.headers || input?.headers, requestUrl(input));
        return originalFetch.apply(this, arguments);
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function (method, input) {
        this._ctmProfileUrl = requestUrl(input);
        return originalOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        if (String(name).toLowerCase() === 'authorization') captureAuthorization({ authorization: value }, this._ctmProfileUrl);
        return originalSetRequestHeader.apply(this, arguments);
    };

    migrateLegacyProfiles();

    function escapeHtml(str = '') {
        return String(str).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
    }
    function truncate(str = '', max = 9999) { return str.length > max ? str.slice(0, max) : str; }

    function toast(message, { duration = 1800 } = {}) {
        for (const old of document.querySelectorAll('.ctm-toast')) old.remove();
        const el = document.createElement('div');
        el.className = 'ctm-toast';
        el.setAttribute('role', 'status');
        el.textContent = message;
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        setTimeout(() => {
            el.classList.remove('show');
            setTimeout(() => el.remove(), 240);
        }, duration);
    }

    function getCurrentChatId() {
        return location.pathname.match(/\/episodes\/([a-f0-9-]+)/i)?.[1] || null;
    }

    function getServerAuthorization() {
        const token = document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/)?.[1];
        return token ? `Bearer ${token}` : capturedToken;
    }

    async function serverRequest(baseUrl, method, path, body) {
        const authorization = getServerAuthorization();
        if (!authorization) throw new Error('로그인 세션을 찾지 못했습니다. 페이지를 새로고침해 주세요.');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(`${baseUrl}${path}`, {
                method,
                credentials: 'include',
                cache: 'no-store',
                signal: controller.signal,
                headers: {
                    Authorization: authorization,
                    'Content-Type': 'application/json',
                    platform: 'web',
                    'wrtn-locale': 'ko-KR',
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            const text = await response.text();
            let payload = null;
            if (text) {
                try { payload = JSON.parse(text); } catch { payload = text; }
            }
            if (!response.ok) {
                const message = payload?.message || payload?.data?.message;
                throw new Error(message || `API 요청 실패 (${response.status})`);
            }
            return payload;
        } catch (error) {
            if (error?.name === 'AbortError') throw new Error('API 응답 시간이 초과되었습니다. 다시 시도해 주세요.');
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    function profileRequest(method, path, body) { return serverRequest(PROFILE_API_BASE, method, path, body); }
    function chatRequest(method, path, body) { return serverRequest(CHAT_API_BASE, method, path, body); }
    function unwrapServerData(response) { return response?.data ?? response; }

    // Server writes keep the original editor's paths and bodies.
    function createServerProfile(accountId, fields) {
        return profileRequest('POST', `/profiles/${accountId}/chat-profiles`, fields);
    }
    function updateServerProfile(accountId, profileId, fields) {
        return profileRequest('PATCH', `/profiles/${accountId}/chat-profiles/${profileId}`, fields);
    }
    function deleteServerProfile(accountId, profileId) {
        return profileRequest('DELETE', `/profiles/${accountId}/chat-profiles/${profileId}`);
    }
    function useServerProfileInChat(chatId, profileId) {
        return chatRequest('PATCH', `/v3/chats/${chatId}`, { chatProfileId: profileId });
    }

    async function loadServerProfileState() {
        const account = unwrapServerData(await profileRequest('GET', '/profiles'));
        const accountId = account?._id ?? account?.id;
        if (!accountId) throw new Error('계정 프로필 ID를 가져오지 못했습니다.');
        const chatId = getCurrentChatId();
        const [listResponse, chatResponse] = await Promise.all([
            profileRequest('GET', `/profiles/${accountId}/chat-profiles`),
            // The list stays usable when only the current-chat lookup fails.
            chatId ? chatRequest('GET', `/v3/chats/${chatId}`).catch(() => null) : Promise.resolve(null),
        ]);
        const listData = unwrapServerData(listResponse);
        const rawProfiles = listData?.chatProfiles ?? listData;
        if (!Array.isArray(rawProfiles)) throw new Error('대화 프로필 목록 응답 형식이 올바르지 않습니다.');
        const currentId = unwrapServerData(chatResponse)?.chatProfile?._id ?? null;
        const profiles = rawProfiles.map((profile) => ({
            id: profile._id ?? profile.id,
            name: profile.name ?? '',
            information: profile.information ?? '',
            createdAt: profile.createdAt ?? null,
            updatedAt: profile.updatedAt ?? null,
            current: (profile._id ?? profile.id) === currentId,
        }));
        return { accountId, chatId, profiles, currentId };
    }

    function getVisibleServerProfiles(profiles, query, sortMode) {
        const keyword = String(query).trim().normalize('NFC').toLocaleLowerCase('ko');
        const option = SERVER_SORT_OPTIONS.find((item) => item.value === sortMode)
            || SERVER_SORT_OPTIONS.find((item) => item.value === DEFAULT_SERVER_SORT);
        const byName = (left, right) => left.name.localeCompare(right.name, 'ko');
        return profiles.filter((profile) => [profile.name, profile.information].some((value) =>
            String(value).normalize('NFC').toLocaleLowerCase('ko').includes(keyword)))
            .sort((left, right) => {
                if (!option.field) return byName(left, right);
                const leftTime = Date.parse(left[option.field]);
                const rightTime = Date.parse(right[option.field]);
                if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
                    return Number(!Number.isFinite(leftTime)) - Number(!Number.isFinite(rightTime)) || byName(left, right);
                }
                return (leftTime - rightTime) * option.direction || byName(left, right);
            });
    }

    function getVisibleLibraryItems(items, query, sortMode) {
        const normalize = (value) => String(value ?? '').normalize('NFC').toLocaleLowerCase('ko');
        const keyword = normalize(String(query).trim());
        const visible = items.filter((item) => [item.name, item.information, item.memo]
            .some((value) => normalize(value).includes(keyword)));
        if (sortMode === 'name') visible.sort((left, right) => String(left.name ?? '').localeCompare(String(right.name ?? ''), 'ko'));
        return visible;
    }

    // Profile memos are keyed by profile name, like the old menu memo. A rename moves
    // the memo unless another profile still uses the old name.
    function updateSlotMemo(memos, { previousName = '', name, memo, keepPrevious = false }) {
        const next = { ...memos };
        const renamed = Boolean(previousName) && previousName !== name;
        if (renamed && !keepPrevious) delete next[previousName];
        if (memo.trim()) next[name] = memo;
        else if (!renamed) delete next[name];
        return next;
    }

    function formatRelativeTime(value, now = Date.now()) {
        const time = Date.parse(value);
        if (!Number.isFinite(time)) return '';
        const minutes = Math.floor((now - time) / 60_000);
        if (minutes < 1) return '방금';
        if (minutes < 60) return `${minutes}분 전`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}시간 전`;
        const days = Math.floor(hours / 24);
        if (days < 30) return `${days}일 전`;
        return new Date(time).toLocaleDateString('ko-KR');
    }

    const ICONS = {
        search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
        sort: '<path d="M7.5 4.5v15M4 8l3.5-3.5L11 8M16.5 19.5v-15M13 16l3.5 3.5L20 16"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        dots: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
        close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
        back: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
        chevron: '<path d="m9.5 6 6 6-6 6"/>',
        check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
        use: '<path d="M4.5 12h14M13 6.5l5.5 5.5-5.5 5.5"/>',
        archive: '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1.2"/><path d="M5.5 9v9a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4"/>',
        inbox: '<path d="M4 13.5h4.2l1.4 2.5h4.8l1.4-2.5H20"/><path d="M6.4 5.5h11.2L20 13.5v4.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18v-4.5z"/>',
        copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
        trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.8 11.6a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7M10 11v5.5M14 11v5.5"/>',
        download: '<path d="M12 4.5v10M7.5 10.5 12 15l4.5-4.5M4.5 15.5v2.5A1.5 1.5 0 0 0 6 19.5h12a1.5 1.5 0 0 0 1.5-1.5v-2.5"/>',
        upload: '<path d="M12 15V5M7.5 9.5 12 5l4.5 4.5M4.5 15.5v2.5A1.5 1.5 0 0 0 6 19.5h12a1.5 1.5 0 0 0 1.5-1.5v-2.5"/>',
        user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5.5 20c.4-3.4 2.9-5.3 6.5-5.3s6.1 1.9 6.5 5.3"/>',
        userPlus: '<circle cx="10" cy="8.5" r="3.5"/><path d="M3.5 20c.4-3.4 2.9-5.3 6.5-5.3 1.5 0 2.8.3 3.8 1M18 13.5v6M15 16.5h6"/>',
    };
    function icon(name) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
    }

    function ensureStyles() {
        if (document.getElementById(UI.styleId)) return;
        const style = document.createElement('style');
        style.id = UI.styleId;
        // 색은 크랙 사이트 변수를 먼저 쓰고, 없을 때만 아래 값을 쓴다.
        style.textContent = `
            .ctm-ui-root, .ctm-toast, .ctm-inline-action {
                --ctm-panel:var(--bg_elevated_primary, #191921); --ctm-canvas:var(--bg_screen, #121218);
                --ctm-raised:var(--bg_elevated_secondary, #22222d); --ctm-field:rgba(255,255,255,.06);
                --ctm-text:var(--text_primary, #e9e9f1); --ctm-sub:var(--text_secondary, #a4a4b4); --ctm-faint:#8b8b9d;
                --ctm-brand:var(--surface_brand_primary, #7a5af5); --ctm-brand-text:var(--text_brand, #a58cff);
                --ctm-brand-tint:rgba(122,90,245,.2); --ctm-brand-line:rgba(165,140,255,.5); --ctm-selection:rgba(122,90,245,.38);
                --ctm-line:rgba(255,255,255,.09); --ctm-hover:rgba(255,255,255,.055); --ctm-avatar:rgba(255,255,255,.08);
                --ctm-scroll:rgba(255,255,255,.16); --ctm-tab-on:var(--ctm-raised); --ctm-menu:var(--ctm-raised);
                --ctm-danger:#f08a9b; --ctm-danger-tint:rgba(240,138,155,.12);
                --ctm-shadow:0 24px 64px rgba(0,0,0,.5),0 4px 14px rgba(0,0,0,.28);
                --ctm-menu-shadow:0 14px 36px rgba(0,0,0,.45),0 2px 8px rgba(0,0,0,.25);
                color:var(--ctm-text); font-family:inherit;
            }
            body[data-theme="light"] .ctm-ui-root, body[data-theme="light"] .ctm-toast, body[data-theme="light"] .ctm-inline-action {
                --ctm-panel:var(--bg_elevated_primary, #ffffff); --ctm-canvas:var(--bg_screen, #f5f5f9);
                --ctm-raised:var(--bg_elevated_secondary, #ececf2); --ctm-field:rgba(20,20,45,.05);
                --ctm-text:var(--text_primary, #1c1c26); --ctm-sub:var(--text_secondary, #585868); --ctm-faint:#6e6e7c;
                --ctm-brand:var(--surface_brand_primary, #6848dc); --ctm-brand-text:var(--text_brand, #6242cf);
                --ctm-brand-tint:rgba(104,72,220,.12); --ctm-brand-line:rgba(104,72,220,.45); --ctm-selection:rgba(104,72,220,.22);
                --ctm-line:rgba(20,20,45,.11); --ctm-hover:rgba(20,20,45,.045); --ctm-avatar:rgba(20,20,45,.07);
                --ctm-scroll:rgba(20,20,45,.2); --ctm-tab-on:var(--ctm-panel); --ctm-menu:var(--ctm-panel);
                --ctm-danger:#b8475d; --ctm-danger-tint:rgba(184,71,93,.09);
                --ctm-shadow:0 24px 64px rgba(20,16,40,.18),0 4px 14px rgba(20,16,40,.08);
                --ctm-menu-shadow:0 14px 36px rgba(20,16,40,.16),0 2px 8px rgba(20,16,40,.08);
            }
            @supports (color: color-mix(in srgb, red, blue)) {
                .ctm-ui-root, .ctm-toast, .ctm-inline-action {
                    --ctm-brand-tint:color-mix(in srgb, var(--ctm-brand) 20%, transparent);
                    --ctm-brand-line:color-mix(in srgb, var(--ctm-brand-text) 50%, transparent);
                    --ctm-selection:color-mix(in srgb, var(--ctm-brand) 38%, transparent);
                }
                body[data-theme="light"] .ctm-ui-root, body[data-theme="light"] .ctm-toast, body[data-theme="light"] .ctm-inline-action {
                    --ctm-brand-tint:color-mix(in srgb, var(--ctm-brand) 12%, transparent);
                    --ctm-brand-line:color-mix(in srgb, var(--ctm-brand) 45%, transparent);
                    --ctm-selection:color-mix(in srgb, var(--ctm-brand) 22%, transparent);
                }
            }
            .ctm-ui-root { pointer-events:auto; }
            .ctm-ui-root, .ctm-ui-root *, .ctm-ui-root *::before, .ctm-ui-root *::after { box-sizing:border-box; }
            .ctm-ui-root * { scrollbar-width:thin; scrollbar-color:var(--ctm-scroll) transparent; }
            .ctm-ui-root [hidden] { display:none !important; }
            .ctm-ui-root ::selection { background:var(--ctm-selection); color:var(--ctm-text); }
            .ctm-ui-root svg { display:block; flex-shrink:0; }

            .ctm-overlay { position:fixed; left:0; right:0; top:var(--ctm-vv-top, 0px); height:var(--ctm-vv-height, 100%); z-index:999999; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(6,6,10,.62); touch-action:none; animation:ctm-fade .18s ease-out; }
            body[data-theme="light"] .ctm-overlay { background:rgba(20,18,32,.36); }
            /* 크랙의 '대화 프로필' 창은 열어 둔 채 뒤에서 숨기고, 이 편집기가 맨 위 층에서 그 자리를 대신한다. */
            html body [role="dialog"][data-ctm-hosted], html body [data-ctm-hosted-overlay] { visibility:hidden !important; }
            .ctm-pm { position:relative; display:flex; flex-direction:column; width:min(780px,100%); height:min(620px,100%); overflow:hidden; border:1px solid var(--ctm-line); border-radius:16px; background:var(--ctm-panel); color:var(--ctm-text); box-shadow:var(--ctm-shadow); font-size:13px; line-height:1.45; letter-spacing:-.005em; word-break:keep-all; overflow-wrap:anywhere; outline:none; animation:ctm-rise .24s cubic-bezier(.16,1,.3,1); }

            .ctm-icon-btn { appearance:none; display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; padding:0; flex-shrink:0; border:0; border-radius:8px; background:transparent; color:var(--ctm-sub); cursor:pointer; -webkit-tap-highlight-color:transparent; transition:background-color .15s ease, color .15s ease; }
            .ctm-icon-btn svg { width:18px; height:18px; }
            .ctm-icon-btn:active, .ctm-icon-btn[aria-expanded="true"] { background:var(--ctm-hover); color:var(--ctm-text); }
            .ctm-btn { appearance:none; display:inline-flex; align-items:center; justify-content:center; gap:6px; height:34px; padding:0 14px; flex-shrink:0; border:1px solid var(--ctm-line); border-radius:9px; background:transparent; color:var(--ctm-text); font:inherit; font-size:13px; font-weight:500; line-height:1; white-space:nowrap; cursor:pointer; -webkit-tap-highlight-color:transparent; transition:background-color .15s ease, border-color .15s ease, color .15s ease, filter .15s ease; }
            .ctm-btn svg { width:16px; height:16px; }
            .ctm-btn:active:not(:disabled) { background:var(--ctm-hover); }
            .ctm-btn.is-ghost { border-color:transparent; color:var(--ctm-sub); }
            .ctm-btn.is-brand { border-color:var(--ctm-brand-line); color:var(--ctm-brand-text); }
            .ctm-btn.is-primary { border-color:var(--ctm-brand); background:var(--ctm-brand); color:#fff; }
            .ctm-btn:disabled { cursor:not-allowed; opacity:.5; }
            .ctm-btn.is-primary:disabled { border-color:transparent; background:var(--ctm-field); color:var(--ctm-faint); opacity:1; }
            .ctm-ui-root button:focus-visible { outline:2px solid var(--ctm-brand-text); outline-offset:2px; }
            .ctm-input { appearance:none; width:100%; min-width:0; margin:0; border:1px solid transparent; border-radius:9px; background:var(--ctm-field); color:var(--ctm-text); font:inherit; font-size:13.5px; line-height:1.5; word-break:normal; caret-color:var(--ctm-brand-text); outline:none; transition:border-color .15s ease, box-shadow .15s ease; }
            input.ctm-input { height:36px; padding:0 12px; }
            textarea.ctm-input { display:block; padding:10px 12px; resize:none; }
            .ctm-input::placeholder { color:var(--ctm-faint); opacity:1; }
            .ctm-input:focus { border-color:var(--ctm-brand-line); box-shadow:0 0 0 3px var(--ctm-brand-tint); }
            .ctm-input::-webkit-search-decoration { -webkit-appearance:none; }

            .ctm-pm-head { display:flex; align-items:center; gap:4px; min-height:54px; padding:9px 10px 9px 20px; flex-shrink:0; border-bottom:1px solid var(--ctm-line); }
            .ctm-pm-heading { display:flex; align-items:baseline; gap:10px; flex:1; min-width:0; }
            .ctm-pm-title { margin:0; color:var(--ctm-text); font-size:16px; font-weight:600; line-height:1.3; letter-spacing:-.01em; white-space:nowrap; }
            .ctm-pm-context { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--ctm-faint); font-size:12.5px; }
            .ctm-pm-context b { color:var(--ctm-brand-text); font-weight:500; }
            .ctm-pm-search-toggle { display:none; }

            .ctm-pm-body { display:grid; grid-template-columns:240px minmax(0,1fr); flex:1; min-height:0; }
            .ctm-pm-side { display:flex; flex-direction:column; gap:10px; min-width:0; min-height:0; padding:12px 10px 10px; border-right:1px solid var(--ctm-line); background:var(--ctm-canvas); }
            .ctm-pm-tabs { display:flex; gap:3px; padding:3px; flex-shrink:0; border-radius:10px; background:var(--ctm-field); }
            .ctm-pm-tab { appearance:none; flex:1; display:inline-flex; align-items:center; justify-content:center; gap:5px; min-width:0; height:30px; padding:0 8px; border:0; border-radius:8px; background:transparent; color:var(--ctm-sub); font:inherit; font-size:12.5px; font-weight:500; white-space:nowrap; cursor:pointer; -webkit-tap-highlight-color:transparent; transition:background-color .15s ease, color .15s ease; }
            .ctm-pm-tab[aria-selected="true"] { background:var(--ctm-tab-on); color:var(--ctm-text); box-shadow:0 1px 3px rgba(0,0,0,.16); }
            .ctm-pm-tab-count { color:var(--ctm-faint); font-weight:400; font-variant-numeric:tabular-nums; }
            .ctm-pm-scope { margin:-3px 4px 0; color:var(--ctm-faint); font-size:11.5px; line-height:1.5; }
            .ctm-pm-search { position:relative; display:flex; align-items:center; flex-shrink:0; }
            .ctm-pm-search > svg { position:absolute; left:10px; width:15px; height:15px; color:var(--ctm-faint); pointer-events:none; }
            .ctm-pm-search .ctm-input { height:34px; padding:0 38px 0 31px; font-size:12.5px; }
            .ctm-pm-search .ctm-pm-sort { position:absolute; right:3px; width:28px; height:28px; border-radius:7px; }
            .ctm-pm-search .ctm-pm-sort svg { width:16px; height:16px; }
            .ctm-pm-list { display:flex; flex-direction:column; gap:2px; flex:1; min-height:0; margin:0 -4px; padding:0 4px 4px; overflow-y:auto; overscroll-behavior:contain; }
            .ctm-pm-group { display:none; align-items:center; justify-content:space-between; gap:8px; padding:12px 8px 4px; flex-shrink:0; color:var(--ctm-faint); font-size:13px; font-weight:500; }
            .ctm-pm-group:first-child { padding-top:0; }
            .ctm-pm-group .ctm-icon-btn { margin-right:-6px; }
            .ctm-pm-side-foot { display:flex; gap:6px; flex-shrink:0; }
            .ctm-pm-side-foot .ctm-icon-btn { width:34px; height:34px; border:1px solid var(--ctm-line); border-radius:9px; }
            .ctm-pm-new { flex:1; color:var(--ctm-sub); }

            .ctm-pm-row { position:relative; display:flex; align-items:center; gap:4px; flex-shrink:0; border-radius:10px; transition:background-color .12s ease; }
            .ctm-pm-row.is-selected { background:var(--ctm-raised); }
            .ctm-pm-pick { appearance:none; display:grid; grid-template-columns:30px minmax(0,1fr); grid-template-areas:"av nm" "av in"; column-gap:10px; row-gap:1px; align-items:center; flex:1; min-width:0; padding:8px; border:0; border-radius:10px; background:transparent; color:inherit; font:inherit; text-align:left; cursor:pointer; -webkit-tap-highlight-color:transparent; }
            .ctm-ui-root .ctm-pm-pick:focus-visible { outline-offset:-2px; }
            .ctm-pm-pick > .ctm-pm-avatar { grid-area:av; }
            .ctm-pm-rowname { grid-area:nm; display:flex; align-items:center; gap:6px; min-width:0; font-size:13.5px; font-weight:600; line-height:1.35; }
            .ctm-pm-rowname-text { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .ctm-pm-badge { flex-shrink:0; color:var(--ctm-brand-text); font-size:11px; font-weight:500; }
            .ctm-pm-badge.is-muted { color:var(--ctm-faint); }
            .ctm-pm-dirtydot { width:6px; height:6px; flex-shrink:0; border-radius:50%; background:var(--ctm-text); }
            .ctm-pm-rowinfo { grid-area:in; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--ctm-sub); font-size:12px; line-height:1.45; }
            .ctm-pm-rowinfo:empty::before { content:'정보 없음'; color:var(--ctm-faint); }
            .ctm-pm-rowedit { grid-area:ed; display:none; align-items:center; height:34px; padding:0 14px; border:1px solid var(--ctm-line); border-radius:10px; color:var(--ctm-text); font-size:13.5px; font-weight:500; }
            .ctm-pm-rowuse { display:none; }
            .ctm-pm-avatar { display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; flex-shrink:0; overflow:hidden; border-radius:50%; background:var(--ctm-avatar); color:var(--ctm-sub); font-size:12.5px; font-weight:600; line-height:1; }
            .ctm-pm-avatar.is-current { background:var(--ctm-brand-tint); color:var(--ctm-brand-text); }
            .ctm-pm-avatar.is-large { width:42px; height:42px; font-size:16px; }
            .ctm-pm-avatar svg { width:55%; height:55%; }
            .ctm-pm-skeleton { height:48px; margin:1px 0; flex-shrink:0; border-radius:10px; background:var(--ctm-hover); animation:ctm-pulse 1.4s ease-in-out infinite; }
            .ctm-pm-skeleton:nth-child(2) { animation-delay:.15s; }
            .ctm-pm-skeleton:nth-child(3) { animation-delay:.3s; }
            .ctm-pm-skeleton:nth-child(4) { animation-delay:.45s; }
            .ctm-pm-notice { padding:22px 12px; color:var(--ctm-sub); font-size:12.5px; line-height:1.6; text-align:center; }
            .ctm-pm-notice strong { display:block; margin-bottom:3px; color:var(--ctm-text); font-size:13.5px; font-weight:600; }
            .ctm-pm-notice.is-error strong { color:var(--ctm-danger); }
            .ctm-pm-notice .ctm-btn { margin-top:12px; }
            .ctm-pm-notice.is-sheet-only { display:none; }

            .ctm-pm-detail { position:relative; display:flex; flex-direction:column; min-width:0; min-height:0; }
            .ctm-pm-detail-head { display:none; align-items:center; gap:2px; padding:10px 8px 6px 6px; flex-shrink:0; }
            .ctm-pm-detail-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:17px; font-weight:600; }
            .ctm-pm-editor { display:flex; flex-direction:column; gap:16px; flex:1; min-height:0; padding:20px 20px 16px; overflow-y:auto; overscroll-behavior:contain; }
            .ctm-pm-identity { display:flex; align-items:center; gap:12px; flex-shrink:0; }
            .ctm-pm-namefield { position:relative; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; flex:1; min-width:0; }
            .ctm-pm-namefield .ctm-pm-label { position:absolute; width:1px; height:1px; margin:-1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
            .ctm-pm-namefield .ctm-input { grid-row:1; grid-column:1 / -1; height:42px; padding:0 64px 0 13px; font-size:15.5px; font-weight:600; }
            .ctm-pm-namefield .ctm-pm-count { position:relative; z-index:1; grid-row:1; grid-column:2; margin-right:13px; pointer-events:none; }
            .ctm-pm-count { color:var(--ctm-faint); font-size:11.5px; font-variant-numeric:tabular-nums; white-space:nowrap; }
            .ctm-pm-count.is-over { color:var(--ctm-danger); }
            .ctm-pm-inuse { display:inline-flex; align-items:center; gap:5px; flex-shrink:0; padding:0 4px; color:var(--ctm-brand-text); font-size:12.5px; font-weight:500; white-space:nowrap; }
            .ctm-pm-inuse svg { width:16px; height:16px; }
            .ctm-pm-field { display:flex; flex-direction:column; gap:7px; min-height:0; }
            .ctm-pm-fieldhead { display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
            .ctm-pm-fieldhead label, .ctm-pm-label { color:var(--ctm-sub); font-size:12.5px; font-weight:500; }
            .ctm-pm-infofield { flex:1 1 auto; min-height:150px; }
            .ctm-pm-infofield .ctm-input { flex:1; min-height:110px; line-height:1.65; }
            .ctm-pm-memo { display:flex; flex-direction:column; gap:6px; flex-shrink:0; }
            .ctm-pm-memo-toggle { appearance:none; align-self:flex-start; display:inline-flex; align-items:center; gap:5px; margin-left:-4px; padding:5px 8px 5px 4px; border:0; border-radius:7px; background:transparent; color:var(--ctm-sub); font:inherit; font-size:12.5px; font-weight:500; cursor:pointer; -webkit-tap-highlight-color:transparent; }
            .ctm-pm-memo-toggle svg { width:14px; height:14px; transition:transform .16s ease; }
            .ctm-pm-memo-toggle[aria-expanded="true"] svg { transform:rotate(90deg); }
            .ctm-pm-memo-dot { width:6px; height:6px; border-radius:50%; background:var(--ctm-brand-text); }
            .ctm-pm-memo-hint { color:var(--ctm-faint); font-weight:400; }
            .ctm-pm-memo-hint::before { content:'· '; }
            .ctm-pm-memo .ctm-input { min-height:88px; resize:vertical; }
            .ctm-pm-error { margin:0; padding:10px 12px; flex-shrink:0; border-radius:10px; background:var(--ctm-danger-tint); color:var(--ctm-danger); font-size:12.5px; line-height:1.5; }
            .ctm-pm-foot { display:flex; align-items:center; gap:10px; min-height:58px; padding:11px 14px 11px 16px; flex-shrink:0; border-top:1px solid var(--ctm-line); }
            .ctm-pm-foot .ctm-pm-more { border:1px solid var(--ctm-line); }
            .ctm-pm-meta { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--ctm-faint); font-size:12px; }
            .ctm-pm-foot-actions { display:flex; align-items:center; gap:6px; margin-left:auto; }
            .ctm-pm-dirty { display:inline-flex; align-items:center; gap:7px; margin-right:4px; color:var(--ctm-sub); font-size:12.5px; white-space:nowrap; }
            .ctm-pm-dirty::before { content:''; width:7px; height:7px; border-radius:50%; background:var(--ctm-text); }
            .ctm-pm-save { min-width:76px; }
            .ctm-pm-blank { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; flex:1; padding:32px 28px; color:var(--ctm-sub); font-size:13px; line-height:1.6; text-align:center; }
            .ctm-pm-blank strong { color:var(--ctm-text); font-size:15px; font-weight:600; }
            .ctm-pm-blank p { max-width:30ch; margin:0; }
            .ctm-pm-blank .ctm-btn { margin-top:10px; }
            .ctm-pm-detail.is-blank > :not(.ctm-pm-blank) { display:none; }
            .ctm-pm-detail:not(.is-blank) > .ctm-pm-blank { display:none; }
            .ctm-pm-file { position:absolute; width:1px; height:1px; opacity:0; pointer-events:none; }

            .ctm-menu { position:fixed; z-index:1000001; min-width:196px; max-width:min(280px, calc(100vw - 16px)); overflow-y:auto; overscroll-behavior:contain; padding:5px; border:1px solid var(--ctm-line); border-radius:12px; background:var(--ctm-menu); color:var(--ctm-text); box-shadow:var(--ctm-menu-shadow); font-size:13px; line-height:1.4; word-break:keep-all; animation:ctm-menu-in .14s ease-out; }
            .ctm-menu.is-wide { min-width:240px; max-width:min(320px, calc(100vw - 16px)); }
            .ctm-menu-title { padding:7px 10px 5px; color:var(--ctm-faint); font-size:11.5px; font-weight:500; }
            .ctm-menu-item { appearance:none; display:flex; align-items:center; gap:10px; width:100%; min-height:36px; padding:7px 10px; border:0; border-radius:8px; background:transparent; color:inherit; font:inherit; text-align:left; cursor:pointer; -webkit-tap-highlight-color:transparent; }
            .ctm-menu-item > svg, .ctm-menu-check { width:16px; height:16px; flex-shrink:0; color:var(--ctm-sub); }
            .ctm-menu-check svg { width:100%; height:100%; color:var(--ctm-brand-text); }
            .ctm-ui-root .ctm-menu-item:focus-visible { outline:none; background:var(--ctm-hover); box-shadow:inset 0 0 0 1.5px var(--ctm-brand-line); }
            .ctm-menu-item:active { background:var(--ctm-hover); }
            .ctm-menu-item.is-danger, .ctm-menu-item.is-danger > svg { color:var(--ctm-danger); }
            .ctm-menu-text { display:flex; flex-direction:column; gap:1px; min-width:0; }
            .ctm-menu-sub { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--ctm-sub); font-size:11.5px; }
            .ctm-menu-sep { height:1px; margin:5px 6px; background:var(--ctm-line); }

            .ctm-toast { position:fixed; left:50%; bottom:28px; z-index:1000002; max-width:calc(100vw - 32px); padding:11px 16px; border-radius:12px; background:var(--ctm-text); color:var(--ctm-panel); box-shadow:var(--ctm-menu-shadow); font-size:13px; font-weight:500; line-height:1.45; text-align:center; word-break:keep-all; opacity:0; transform:translate(-50%, 8px); transition:opacity .2s ease, transform .24s cubic-bezier(.16,1,.3,1); pointer-events:none; }
            .ctm-toast.show { opacity:1; transform:translate(-50%, 0); }
            .ctm-inline-action { appearance:none; display:inline-flex; align-items:center; height:24px; padding:0 9px; border:1px solid var(--ctm-line); border-radius:7px; background:var(--ctm-hover); color:var(--ctm-text); font:inherit; font-size:12px; font-weight:500; line-height:1; white-space:nowrap; vertical-align:middle; cursor:pointer; -webkit-tap-highlight-color:transparent; transition:border-color .15s ease, color .15s ease; }
            .ctm-inline-action:focus-visible { outline:2px solid var(--ctm-brand-text); outline-offset:2px; }

            @media (hover: hover) {
                .ctm-icon-btn:hover { background:var(--ctm-hover); color:var(--ctm-text); }
                .ctm-btn:hover:not(:disabled) { background:var(--ctm-hover); }
                .ctm-btn.is-primary:hover:not(:disabled) { background:var(--ctm-brand); filter:brightness(1.1); }
                .ctm-pm-tab:hover:not([aria-selected="true"]) { color:var(--ctm-text); }
                .ctm-pm-row:not(.is-selected):hover { background:var(--ctm-hover); }
                .ctm-pm-memo-toggle:hover { color:var(--ctm-text); }
                .ctm-menu-item:hover { background:var(--ctm-hover); }
                .ctm-inline-action:hover { border-color:var(--ctm-brand-line); color:var(--ctm-brand-text); }
            }
            @media (pointer: coarse) {
                .ctm-inline-action { height:30px; padding:0 12px; font-size:13px; }
            }
            @media (max-width: 767px) {
                .ctm-overlay { align-items:flex-end; padding:max(28px, env(safe-area-inset-top, 0px)) 0 0; }
                .ctm-pm { width:100%; height:100%; border-width:1px 0 0; border-radius:18px 18px 0 0; font-size:15px; animation:ctm-sheet .3s cubic-bezier(.16,1,.3,1); }
                .ctm-pm-body { display:flex; flex-direction:column; }
                .ctm-pm-side, .ctm-pm-detail { flex:1; }
                .ctm-ui-root[data-view="list"] .ctm-pm-detail,
                .ctm-ui-root[data-view="detail"] .ctm-pm-side,
                .ctm-ui-root[data-view="detail"] .ctm-pm-head { display:none; }
                .ctm-icon-btn { width:40px; height:40px; border-radius:10px; }
                .ctm-icon-btn svg { width:20px; height:20px; }
                .ctm-btn { height:40px; padding:0 15px; border-radius:11px; font-size:14.5px; }
                .ctm-input { border-radius:12px; font-size:16px; }
                textarea.ctm-input { padding:12px 14px; }

                .ctm-pm-head { min-height:0; padding:14px 8px 8px 20px; border-bottom:0; }
                .ctm-pm-title { font-size:18px; }
                .ctm-pm-context { display:none; }
                .ctm-pm-search-toggle { display:inline-flex; }
                .ctm-pm-side { gap:0; padding:0; border-right:0; background:transparent; }
                .ctm-pm-tabs { margin:2px 16px 10px; border-radius:12px; }
                .ctm-pm-tab { height:38px; border-radius:10px; font-size:14.5px; }
                .ctm-pm-scope { margin:-2px 20px 10px; font-size:13px; }
                .ctm-pm-search { display:none; margin:0 16px 10px; }
                .ctm-ui-root.is-search-open .ctm-pm-search { display:flex; }
                .ctm-pm-search > svg { left:13px; width:18px; height:18px; }
                .ctm-pm-search .ctm-input { height:44px; padding:0 14px 0 40px; font-size:16px; }
                .ctm-pm-search .ctm-pm-sort { display:none; }
                .ctm-pm-list { margin:0; padding:0 12px 12px; }
                .ctm-pm-group { display:flex; }
                .ctm-pm-notice.is-sheet-only { display:block; }
                .ctm-pm-row.is-selected { background:transparent; }
                .ctm-pm-pick { grid-template-columns:38px minmax(0,1fr); column-gap:12px; min-height:60px; padding:10px 8px; border-radius:12px; }
                .ctm-pm-avatar { width:38px; height:38px; font-size:14.5px; }
                .ctm-pm-rowname { font-size:15.5px; }
                .ctm-pm-badge { font-size:12.5px; }
                .ctm-pm-rowinfo { font-size:13.5px; }
                .ctm-pm-rowuse { display:inline-flex; height:40px; margin-right:4px; padding:0 14px; font-size:14px; }
                .ctm-pm-row.is-current { margin:0 0 6px; border:1px solid var(--ctm-brand-line); border-radius:16px; background:var(--ctm-raised); }
                .ctm-pm-row.is-current .ctm-pm-pick { grid-template-columns:44px minmax(0,1fr) auto; grid-template-areas:"av nm ed" "in in in"; row-gap:10px; padding:14px; border-radius:16px; }
                .ctm-pm-row.is-current .ctm-pm-avatar { width:44px; height:44px; font-size:16px; }
                .ctm-pm-row.is-current .ctm-pm-rowname { flex-direction:column; align-items:flex-start; gap:2px; font-size:16px; }
                .ctm-pm-row.is-current .ctm-pm-rowinfo { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; white-space:normal; line-height:1.55; }
                .ctm-pm-row.is-current .ctm-pm-rowedit { display:inline-flex; }
                .ctm-pm-side-foot { gap:8px; padding:10px 16px calc(10px + env(safe-area-inset-bottom, 0px)); border-top:1px solid var(--ctm-line); }
                .ctm-pm-side-foot .ctm-btn { height:46px; }
                .ctm-pm-side-foot .ctm-icon-btn { width:46px; height:46px; border:1px solid var(--ctm-line); border-radius:11px; }

                .ctm-pm-detail-head { display:flex; }
                .ctm-pm-editor { gap:18px; padding:4px 16px 16px; }
                .ctm-pm-identity { flex-direction:column; align-items:stretch; gap:0; }
                .ctm-pm-identity > .ctm-pm-avatar, .ctm-pm-identity > .ctm-pm-use, .ctm-pm-identity > .ctm-pm-inuse { display:none; }
                .ctm-pm-namefield { row-gap:8px; }
                .ctm-pm-namefield .ctm-pm-label { position:static; grid-row:1; grid-column:1; width:auto; height:auto; margin:0; overflow:visible; clip:auto; white-space:normal; }
                .ctm-pm-namefield .ctm-pm-count { grid-row:1; margin:0; }
                .ctm-pm-namefield .ctm-input { grid-row:2; height:48px; padding:0 14px; font-size:16px; font-weight:500; }
                .ctm-pm-label, .ctm-pm-fieldhead label { font-size:13.5px; }
                .ctm-pm-count { font-size:12.5px; }
                .ctm-pm-infofield { min-height:190px; }
                .ctm-pm-memo-toggle { padding:8px 8px 8px 4px; font-size:14px; }
                .ctm-pm-memo .ctm-input { resize:none; }
                .ctm-pm-error { font-size:14px; }
                .ctm-pm-foot { gap:8px; padding:10px 16px calc(10px + env(safe-area-inset-bottom, 0px)); }
                .ctm-pm-foot .ctm-pm-more { display:none; }
                .ctm-pm-foot .ctm-btn { height:46px; }
                .ctm-pm-save { min-width:96px; }
                .ctm-pm-meta { font-size:13px; }
                .ctm-pm-dirty { font-size:13.5px; }

                .ctm-menu { min-width:220px; border-radius:14px; }
                .ctm-menu-item { min-height:46px; font-size:15px; }
                .ctm-menu-item > svg, .ctm-menu-check { width:19px; height:19px; }
                .ctm-menu-sub { font-size:13px; }
                .ctm-toast { top:calc(12px + env(safe-area-inset-top, 0px)); bottom:auto; transform:translate(-50%, -8px); font-size:14px; }
                .ctm-toast.show { transform:translate(-50%, 0); }
            }
            @media (max-width: 360px) {
                .ctm-pm-dirty-text { display:none; }
                .ctm-pm-foot .ctm-btn { padding:0 12px; }
                .ctm-pm-save { min-width:80px; }
            }
            @keyframes ctm-fade { from { opacity:0; } }
            @keyframes ctm-rise { from { opacity:0; transform:translateY(10px) scale(.985); } }
            @keyframes ctm-sheet { from { transform:translateY(100%); } }
            @keyframes ctm-menu-in { from { opacity:0; transform:translateY(-4px); } }
            @keyframes ctm-pulse { 50% { opacity:.45; } }
            @media (prefers-reduced-motion: reduce) {
                .ctm-overlay, .ctm-pm, .ctm-menu, .ctm-pm-skeleton { animation:none; }
                .ctm-toast { transition:opacity .2s ease; }
            }
        `;
        document.head.appendChild(style);
    }

    // 크랙의 '대화 프로필' 창 대신 띄운 편집기
    let hostedRoot = null;

    function removeExistingRoot() {
        const old = document.getElementById(UI.rootId);
        if (!old) return;
        old._ctmCleanup?.();
        old.remove();
    }

    // 크랙 프로필(서버)과 보관함(이 브라우저)을 한 창의 탭으로 관리한다.
    // host(크랙의 '대화 프로필' 창)를 넘기면 그 창을 뒤에 숨긴 채 대신 뜨고, 닫기도 크랙 창을 닫는 것으로 처리한다.
    // 크랙 창 안에 넣으면 사이트 상단 바보다 낮은 층에 갇혀서, 편집기는 항상 body에 둔다.
    function openProfileManager({ source = 'server', host = null } = {}) {
        ensureStyles();
        removeExistingRoot();

        const DRAFT = '__draft__';
        const sheetQuery = window.matchMedia(SHEET_QUERY);
        const viewport = window.visualViewport;
        const returnFocus = document.activeElement;
        const root = document.createElement('div');
        root.id = UI.rootId;
        root.className = 'ctm-ui-root';
        root.dataset.view = 'list';
        root.innerHTML = `
            <div class="ctm-overlay">
                <section class="ctm-pm" role="dialog" aria-modal="true" aria-labelledby="ctmPmTitle" tabindex="-1">
                    <header class="ctm-pm-head">
                        <div class="ctm-pm-heading">
                            <h2 class="ctm-pm-title" id="ctmPmTitle">대화 프로필</h2>
                            <span class="ctm-pm-context" data-el="context" hidden></span>
                        </div>
                        <button class="ctm-icon-btn ctm-pm-search-toggle" type="button" data-action="toggle-search" data-el="search-toggle" aria-label="검색" aria-expanded="false">${icon('search')}</button>
                        <button class="ctm-icon-btn" type="button" data-action="close" aria-label="닫기">${icon('close')}</button>
                    </header>
                    <div class="ctm-pm-body">
                        <aside class="ctm-pm-side" aria-label="프로필 목록">
                            <div class="ctm-pm-tabs" role="tablist" aria-label="저장 위치">
                                <button class="ctm-pm-tab" type="button" role="tab" id="ctmPmTabServer" data-action="tab" data-source="server" aria-controls="ctmPmList">크랙 프로필<span class="ctm-pm-tab-count" data-el="count-server"></span></button>
                                <button class="ctm-pm-tab" type="button" role="tab" id="ctmPmTabLibrary" data-action="tab" data-source="library" aria-controls="ctmPmList">보관함<span class="ctm-pm-tab-count" data-el="count-library"></span></button>
                            </div>
                            <p class="ctm-pm-scope" data-el="scope" hidden>이 브라우저에만 저장돼요. 크랙 서버와는 따로예요.</p>
                            <div class="ctm-pm-search">
                                ${icon('search')}
                                <input class="ctm-input" type="search" data-el="search" autocomplete="off" enterkeyhint="search" placeholder="이름·내용 검색" aria-label="이름이나 내용으로 검색">
                                <button class="ctm-icon-btn ctm-pm-sort" type="button" data-action="sort" aria-label="정렬" aria-haspopup="menu" aria-expanded="false">${icon('sort')}</button>
                            </div>
                            <div class="ctm-pm-list" id="ctmPmList" role="tabpanel" data-el="list"></div>
                            <div class="ctm-pm-side-foot">
                                <button class="ctm-btn ctm-pm-new" type="button" data-action="new">${icon('plus')}<span data-el="new-label">새 프로필</span></button>
                                <button class="ctm-icon-btn" type="button" data-action="library-tools" data-el="tools" aria-label="보관함 백업·복원" aria-haspopup="menu" aria-expanded="false" hidden>${icon('dots')}</button>
                            </div>
                        </aside>
                        <div class="ctm-pm-detail" data-el="detail">
                            <div class="ctm-pm-detail-head">
                                <button class="ctm-icon-btn" type="button" data-action="back" aria-label="목록으로">${icon('back')}</button>
                                <span class="ctm-pm-detail-title" data-el="detail-title"></span>
                                <button class="ctm-icon-btn" type="button" data-action="more" aria-label="더보기" aria-haspopup="menu" aria-expanded="false">${icon('dots')}</button>
                            </div>
                            <div class="ctm-pm-editor" data-el="editor">
                                <div class="ctm-pm-identity">
                                    <span class="ctm-pm-avatar is-large" data-el="avatar" aria-hidden="true"></span>
                                    <div class="ctm-pm-namefield">
                                        <label class="ctm-pm-label" for="ctmPmName">이름</label>
                                        <span class="ctm-pm-count" data-el="name-count" aria-hidden="true"></span>
                                        <input class="ctm-input" id="ctmPmName" data-el="name" maxlength="${NAME_MAX}" autocomplete="off" enterkeyhint="next" placeholder="나의 이름">
                                    </div>
                                    <button class="ctm-btn is-brand ctm-pm-use" type="button" data-action="use" data-el="use">이 대화에 사용</button>
                                    <span class="ctm-pm-inuse" data-el="inuse">${icon('check')}이 대화에서 사용 중</span>
                                    <button class="ctm-btn is-brand ctm-pm-use" type="button" data-action="promote" data-el="promote">크랙 프로필로 추가</button>
                                </div>
                                <div class="ctm-pm-field ctm-pm-infofield">
                                    <div class="ctm-pm-fieldhead"><label for="ctmPmInfo">정보</label><span class="ctm-pm-count" data-el="info-count" aria-hidden="true"></span></div>
                                    <textarea class="ctm-input" id="ctmPmInfo" data-el="info" maxlength="${INFO_MAX}" placeholder="나이, 성별, 외형, 성격 등 캐릭터가 알아야 할 내 정보"></textarea>
                                </div>
                                <div class="ctm-pm-memo">
                                    <button class="ctm-pm-memo-toggle" type="button" data-action="memo" data-el="memo-toggle" aria-expanded="false" aria-controls="ctmPmMemo">${icon('chevron')}메모<span class="ctm-pm-memo-hint" data-el="memo-hint"></span><span class="ctm-pm-memo-dot" data-el="memo-dot" aria-label="메모 있음" hidden></span></button>
                                    <textarea class="ctm-input" id="ctmPmMemo" data-el="memo" aria-label="메모" placeholder="설정 메모나 다음에 쓸 문장" hidden></textarea>
                                </div>
                                <p class="ctm-pm-error" data-el="error" role="alert" hidden></p>
                            </div>
                            <div class="ctm-pm-blank" data-el="blank"></div>
                            <footer class="ctm-pm-foot">
                                <button class="ctm-icon-btn ctm-pm-more" type="button" data-action="more" aria-label="더보기" aria-haspopup="menu" aria-expanded="false">${icon('dots')}</button>
                                <span class="ctm-pm-meta" data-el="meta"></span>
                                <div class="ctm-pm-foot-actions">
                                    <span class="ctm-pm-dirty" data-el="dirty" hidden><span class="ctm-pm-dirty-text">저장 안 됨</span></span>
                                    <button class="ctm-btn is-ghost" type="button" data-action="revert" data-el="revert" hidden>되돌리기</button>
                                    <button class="ctm-btn is-primary ctm-pm-save" type="button" data-action="save" data-el="save">저장</button>
                                </div>
                            </footer>
                        </div>
                    </div>
                    <input class="ctm-pm-file" type="file" accept=".json,application/json" data-el="import" tabindex="-1" aria-hidden="true">
                </section>
            </div>
        `;
        document.body.appendChild(root);
        root._ctmHost = host;
        if (host) hostedRoot = root;

        const overlay = root.querySelector('.ctm-overlay');
        const panel = root.querySelector('.ctm-pm');
        const el = {};
        for (const node of root.querySelectorAll('[data-el]')) el[node.dataset.el] = node;

        const state = {
            source: source === 'library' ? 'library' : 'server',
            view: 'list',
            query: '',
            searchOpen: false,
            memoOpen: false,
            busy: '',
            error: '',
            // 선택한 항목을 폼에 불러온 값. 폼과 다르면 저장하지 않은 변경이 있다.
            baseline: null,
            server: { status: 'loading', message: '', accountId: null, chatId: getCurrentChatId(), items: [], selected: null, sort: DEFAULT_SERVER_SORT, draft: null },
            library: { items: loadLibrary(), selected: null, sort: 'saved', draft: null },
        };
        let menu = null;
        let pointerStartedOnBackdrop = false;
        let allowNativeEscape = false;
        let hostOverlay = null;

        const store = () => state[state.source];
        const keyOf = (item) => (item.isDraft ? DRAFT : String(item.id));
        const findItem = (key, target = store()) => (key === DRAFT
            ? target.draft
            : target.items.find((item) => String(item.id) === key)) || null;
        const getSelected = (target = store()) => (target.selected ? findItem(target.selected, target) : null);
        const isSheet = () => sheetQuery.matches;
        const isEditorVisible = () => !isSheet() || state.view === 'detail';

        function formValues() {
            return { name: el.name.value, information: el.info.value, memo: el.memo.value };
        }
        function isDirty() {
            const base = state.baseline;
            if (!base) return false;
            const values = formValues();
            return values.name !== base.name || values.information !== base.information || values.memo !== base.memo;
        }
        function memoFor(item) {
            if (!item || item.isDraft) return '';
            if (state.source === 'library') return String(item.memo ?? '');
            return item.name ? String(loadSlotMemos()[item.name] ?? '') : '';
        }
        function fillForm(item) {
            const values = { name: String(item?.name ?? ''), information: String(item?.information ?? ''), memo: memoFor(item) };
            el.name.value = values.name;
            el.info.value = values.information;
            el.memo.value = values.memo;
            state.baseline = item ? values : null;
            state.error = '';
        }
        function confirmDiscard(message = '저장하지 않은 변경사항이 있어요. 버리고 계속할까요?') {
            return !isDirty() || confirm(message);
        }

        function ensureSelection(target, { preferredId = null, preferredName = null } = {}) {
            if (target.selected === DRAFT && target.draft && preferredId == null && !preferredName) return;
            const byId = (id) => id != null && id !== DRAFT && target.items.find((item) => String(item.id) === String(id));
            const visible = target === state.server
                ? getVisibleServerProfiles(target.items, '', target.sort)
                : getVisibleLibraryItems(target.items, '', target.sort);
            const next = byId(preferredId)
                || (preferredName && target.items.find((item) => item.name === preferredName))
                || byId(target.selected)
                || target.items.find((item) => item.current)
                || visible[0];
            target.selected = next ? String(next.id) : null;
        }

        async function loadServer(preferred = {}) {
            const next = await loadServerProfileState();
            if (!root.isConnected) return;
            const target = state.server;
            const previous = target.selected;
            const keepForm = state.source === 'server' && isDirty();
            Object.assign(target, { status: 'ready', message: '', accountId: next.accountId, chatId: next.chatId, items: next.profiles });
            ensureSelection(target, preferred);
            if (state.source === 'server' && !(keepForm && target.selected === previous)) fillForm(getSelected(target));
        }
        function startServerLoad() {
            const target = state.server;
            target.status = 'loading';
            render();
            loadServer()
                .catch((error) => {
                    if (!root.isConnected) return;
                    target.status = 'error';
                    target.message = error.message;
                })
                .finally(() => {
                    if (root.isConnected) render();
                });
        }
        function reloadLibrary(preferredId = null) {
            state.library.items = loadLibrary();
            ensureSelection(state.library, { preferredId });
        }

        function render() {
            root.dataset.view = state.view;
            root.classList.toggle('is-search-open', state.searchOpen || Boolean(state.query));
            renderChrome();
            renderList();
            renderDetail();
        }
        function renderChrome() {
            for (const tab of root.querySelectorAll('.ctm-pm-tab')) {
                const active = tab.dataset.source === state.source;
                tab.setAttribute('aria-selected', String(active));
                tab.tabIndex = active ? 0 : -1;
            }
            el['count-server'].textContent = state.server.status === 'ready' ? String(state.server.items.length) : '';
            el['count-library'].textContent = String(state.library.items.length);
            el.list.setAttribute('aria-labelledby', state.source === 'server' ? 'ctmPmTabServer' : 'ctmPmTabLibrary');
            el.scope.hidden = state.source !== 'library';
            el.tools.hidden = state.source !== 'library';
            el['new-label'].textContent = state.source === 'server' ? '새 프로필' : '새 항목';
            el['search-toggle'].setAttribute('aria-expanded', String(root.classList.contains('is-search-open')));
            const current = state.server.items.find((item) => item.current);
            el.context.hidden = !current;
            el.context.innerHTML = current ? `이 대화 · <b>${escapeHtml(current.name || '이름 없음')}</b>` : '';
        }
        function renderList() {
            const target = store();
            const active = document.activeElement;
            const focusKey = el.list.contains(active) ? active.closest('.ctm-pm-row')?.dataset.key : null;
            const focusAction = focusKey ? active.dataset.action : null;
            if (state.source === 'server' && target.status !== 'ready') {
                el.list.innerHTML = target.status === 'loading'
                    ? '<div class="ctm-pm-skeleton"></div>'.repeat(4)
                    : `<div class="ctm-pm-notice is-error" role="alert"><strong>크랙 프로필을 불러오지 못했어요</strong>${escapeHtml(target.message)}<br><button class="ctm-btn" type="button" data-action="retry">다시 시도</button></div>`;
                return;
            }
            const items = state.source === 'server'
                ? getVisibleServerProfiles(target.items, state.query, target.sort)
                : getVisibleLibraryItems(target.items, state.query, target.sort);
            // 이 대화에서 쓰는 프로필은 정렬과 상관없이 맨 위에 둔다.
            const current = items.find((item) => item.current) || null;
            const others = items.filter((item) => item !== current);
            if (target.draft) others.unshift(target.draft);
            const label = state.source === 'library' ? '보관함' : current ? '다른 프로필' : '프로필';
            const sortButton = `<button class="ctm-icon-btn" type="button" data-action="sort" aria-label="정렬" aria-haspopup="menu" aria-expanded="false">${icon('sort')}</button>`;
            const otherCount = others.filter((item) => !item.isDraft).length;
            let html = current ? `<div class="ctm-pm-group"><span>이 대화</span></div>${rowTemplate(current)}` : '';
            if (otherCount || target.draft) html += `<div class="ctm-pm-group"><span>${label} ${otherCount}</span>${otherCount > 1 ? sortButton : ''}</div>`;
            html += others.map(rowTemplate).join('');
            if (!items.length && !target.draft) html += emptyListTemplate();
            el.list.innerHTML = html;
            syncRowDirty();
            if (focusKey) {
                el.list.querySelector(`.ctm-pm-row[data-key="${CSS.escape(focusKey)}"] [data-action="${focusAction}"]`)?.focus({ preventScroll: true });
            }
        }
        function rowTemplate(item) {
            const selected = keyOf(item) === store().selected;
            const inUse = state.source === 'server' && Boolean(item.current);
            const name = item.isDraft ? (state.source === 'server' ? '새 프로필' : '새 항목') : (item.name || '이름 없음');
            const badge = item.isDraft ? '<span class="ctm-pm-badge is-muted">작성 중</span>'
                : inUse ? '<span class="ctm-pm-badge">사용 중</span>'
                    : state.source === 'library' && String(item.memo ?? '').trim() ? '<span class="ctm-pm-badge is-muted">메모</span>' : '';
            const canUse = state.source === 'server' && state.server.chatId && !item.isDraft && !inUse;
            return `<div class="ctm-pm-row${selected ? ' is-selected' : ''}${inUse ? ' is-current' : ''}" data-key="${escapeHtml(keyOf(item))}">`
                + `<button class="ctm-pm-pick" type="button" data-action="pick"${selected ? ' aria-current="true"' : ''}>`
                + avatarMarkup(item.isDraft ? '' : item.name, inUse)
                + `<span class="ctm-pm-rowname"><span class="ctm-pm-rowname-text">${escapeHtml(name)}</span>${badge}<span class="ctm-pm-dirtydot" aria-hidden="true" hidden></span></span>`
                + `<span class="ctm-pm-rowinfo">${escapeHtml(item.information || '')}</span>`
                + (inUse ? '<span class="ctm-pm-rowedit" aria-hidden="true">편집</span>' : '')
                + '</button>'
                + (canUse ? `<button class="ctm-btn ctm-pm-rowuse" type="button" data-action="use" aria-label="‘${escapeHtml(name)}’ 프로필을 이 대화에 사용">사용</button>` : '')
                + '</div>';
        }
        function avatarMarkup(name, inUse) {
            const initial = Array.from(String(name ?? '').trim())[0];
            return `<span class="ctm-pm-avatar${inUse ? ' is-current' : ''}" aria-hidden="true">${initial ? escapeHtml(initial) : icon('user')}</span>`;
        }
        function emptyListTemplate() {
            if (state.query.trim()) return '<div class="ctm-pm-notice"><strong>검색 결과가 없어요</strong>다른 이름이나 내용으로 찾아보세요.</div>';
            return state.source === 'server'
                ? '<div class="ctm-pm-notice is-sheet-only"><strong>아직 대화 프로필이 없어요</strong>아래 ‘새 프로필’로 만들 수 있어요.</div>'
                : '<div class="ctm-pm-notice is-sheet-only"><strong>보관함이 비어 있어요</strong>크랙 프로필의 더보기 메뉴에서 ‘보관함에 복사’로 담을 수 있어요.</div>';
        }
        function syncRowDirty() {
            const dot = el.list.querySelector('.ctm-pm-row.is-selected .ctm-pm-dirtydot');
            if (dot) dot.hidden = !isDirty();
        }
        function renderDetail() {
            const target = store();
            const item = getSelected();
            const isServer = state.source === 'server';
            el.detail.classList.toggle('is-blank', !item);
            panel.setAttribute('aria-busy', String(Boolean(state.busy)));
            if (!item) {
                el.blank.innerHTML = blankTemplate();
                return;
            }
            const values = formValues();
            const dirty = isDirty();
            const inUse = isServer && Boolean(item.current);
            el['detail-title'].textContent = values.name.trim()
                || (item.isDraft ? (isServer ? '새 프로필' : '새 항목') : '이름 없음');
            const initial = Array.from(values.name.trim())[0];
            el.avatar.classList.toggle('is-current', inUse);
            if (initial) el.avatar.textContent = initial;
            else el.avatar.innerHTML = icon('user');
            el['name-count'].textContent = `${values.name.length} / ${NAME_MAX}`;
            el['info-count'].textContent = `${values.information.length} / ${INFO_MAX}`;
            el['info-count'].classList.toggle('is-over', values.information.length > INFO_MAX);
            el.use.hidden = !isServer || item.isDraft || inUse || !target.chatId;
            el.inuse.hidden = !inUse;
            el.promote.hidden = isServer || item.isDraft;
            el['memo-hint'].textContent = isServer ? '이 브라우저에만 저장' : '불러올 때 함께 적용';
            el.memo.hidden = !state.memoOpen;
            el['memo-toggle'].setAttribute('aria-expanded', String(state.memoOpen));
            el['memo-dot'].hidden = state.memoOpen || !values.memo.trim();
            el.error.hidden = !state.error;
            el.error.textContent = state.error;
            el.dirty.hidden = !dirty;
            el.revert.hidden = !dirty;
            el.meta.textContent = dirty ? '' : metaText(item);
            el.save.disabled = Boolean(state.busy) || !dirty;
            el.save.textContent = state.busy === 'save' ? '저장 중…' : '저장';
            el.use.disabled = Boolean(state.busy);
            el.use.textContent = state.busy === 'use' ? '적용 중…' : '이 대화에 사용';
            el.promote.disabled = Boolean(state.busy);
            el.promote.textContent = state.busy === 'promote' ? '추가 중…' : '크랙 프로필로 추가';
        }
        function metaText(item) {
            if (item.isDraft) return state.source === 'server' ? '저장하면 크랙에 새 프로필이 생겨요' : '저장하면 보관함에 추가돼요';
            const when = formatRelativeTime(item.updatedAt);
            return when ? `마지막 수정 ${when}` : '';
        }
        function blankTemplate() {
            if (state.source === 'server') {
                if (state.server.status !== 'ready') return '';
                return `<strong>아직 대화 프로필이 없어요</strong><p>새 프로필을 만들면 크랙에 바로 저장돼요.</p><button class="ctm-btn is-primary" type="button" data-action="new">${icon('plus')}새 프로필</button>`;
            }
            return `<strong>보관함이 비어 있어요</strong><p>크랙 프로필의 더보기 메뉴에서 ‘보관함에 복사’를 누르거나 새 항목을 만들어 담아 두세요.</p><button class="ctm-btn" type="button" data-action="new">${icon('plus')}새 항목</button>`;
        }

        function setView(view) {
            state.view = view;
            root.dataset.view = view;
        }
        function setBusy(action) {
            state.busy = action;
            renderDetail();
        }
        function fail(message, field = null) {
            // 모바일 목록 화면에서는 편집 칸이 안 보이므로 알림으로만 보여 준다.
            if (!isEditorVisible()) {
                toast(message, { duration: 3500 });
                return false;
            }
            state.error = message;
            renderDetail();
            field?.focus();
            return false;
        }
        function onFormInput() {
            state.error = '';
            renderDetail();
            syncRowDirty();
        }

        function select(key) {
            const target = store();
            if (state.busy || !findItem(key)) return;
            if (key !== target.selected) {
                if (!confirmDiscard()) return;
                if (target.selected === DRAFT) target.draft = null;
                target.selected = key;
                fillForm(getSelected());
                el.editor.scrollTop = 0;
            }
            setView('detail');
            render();
        }
        function goBack() {
            const target = store();
            closeMenu();
            // 아무것도 쓰지 않은 새 항목은 목록으로 돌아갈 때 버린다.
            if (target.selected === DRAFT && !isDirty()) {
                target.draft = null;
                target.selected = null;
                ensureSelection(target);
                fillForm(getSelected());
            }
            setView('list');
            render();
            el.list.querySelector('.ctm-pm-row.is-selected .ctm-pm-pick')?.focus({ preventScroll: true });
        }
        function switchSource(next) {
            if (next === state.source || state.busy) return;
            if (!confirmDiscard()) return;
            const previous = store();
            if (previous.selected === DRAFT) {
                previous.draft = null;
                previous.selected = null;
            }
            state.source = next;
            state.query = '';
            el.search.value = '';
            if (next === 'library') reloadLibrary();
            ensureSelection(store());
            fillForm(getSelected());
            el.editor.scrollTop = 0;
            setView('list');
            render();
        }
        function startDraft() {
            const target = store();
            if (state.busy) return;
            if (state.source === 'server' && target.status !== 'ready') {
                toast('크랙 프로필을 불러온 뒤에 만들 수 있어요');
                return;
            }
            if (target.selected !== DRAFT) {
                if (!confirmDiscard()) return;
                target.draft = { isDraft: true, id: null, name: '', information: '' };
                target.selected = DRAFT;
                fillForm(target.draft);
                el.editor.scrollTop = 0;
            }
            state.query = '';
            el.search.value = '';
            setView('detail');
            render();
            el.name.focus({ preventScroll: true });
        }
        function revert() {
            const item = getSelected();
            if (!item || state.busy) return;
            fillForm(item);
            render();
        }

        async function save() {
            const item = getSelected();
            if (!item || state.busy || !isDirty()) return false;
            return state.source === 'server' ? saveServerItem(item) : saveLibraryItem(item);
        }
        async function saveServerItem(item) {
            const target = state.server;
            const values = formValues();
            const name = values.name.trim();
            if (!name) return fail('이름을 입력해 주세요.', el.name);
            if (values.information.length > INFO_MAX) return fail(`정보는 ${INFO_MAX}자까지 저장할 수 있어요.`, el.info);
            const fields = { name, information: values.information };
            const writesServer = item.isDraft || name !== item.name || values.information !== item.information;
            setBusy('save');
            try {
                let savedId = item.id;
                if (writesServer) {
                    const saved = unwrapServerData(item.isDraft
                        ? await createServerProfile(target.accountId, fields)
                        : await updateServerProfile(target.accountId, item.id, fields));
                    savedId = saved?._id ?? saved?.id ?? savedId;
                }
                const sharedName = !item.isDraft && target.items.some((other) => other !== item && other.name === item.name);
                saveSlotMemos(updateSlotMemo(loadSlotMemos(), {
                    previousName: item.isDraft ? '' : item.name, name, memo: values.memo, keepPrevious: sharedName,
                }));
                el.name.value = name;
                state.baseline = { ...values, name };
                if (writesServer) {
                    target.draft = null;
                    target.selected = savedId != null ? String(savedId) : null;
                    await loadServer({ preferredId: savedId, preferredName: name })
                        .catch(() => applyLocalSave(item, savedId, fields));
                }
                toast('저장했어요');
                return true;
            } catch (error) {
                return fail(`저장하지 못했어요. ${error.message}`);
            } finally {
                setBusy('');
                render();
            }
        }
        // 저장은 됐지만 목록을 다시 받지 못했을 때 화면만 맞춘다.
        function applyLocalSave(item, savedId, fields) {
            const target = state.server;
            const updatedAt = new Date().toISOString();
            if (item.isDraft && savedId != null) target.items.push({ id: savedId, ...fields, createdAt: updatedAt, updatedAt, current: false });
            else if (!item.isDraft) Object.assign(item, fields, { updatedAt });
            ensureSelection(target, { preferredId: savedId });
            fillForm(getSelected(target));
        }
        function saveLibraryItem(item) {
            const values = formValues();
            const name = truncate(values.name.trim(), NAME_MAX);
            const information = values.information.trim();
            if (!name && !information) return fail('이름이나 정보를 입력해 주세요.', el.name);
            const items = loadLibrary();
            const updatedAt = new Date().toISOString();
            let id = item.id;
            if (item.isDraft) {
                id = `lib_${Date.now()}`;
                items.unshift({ id, name, information, memo: values.memo, updatedAt });
            } else {
                const index = items.findIndex((entry) => String(entry.id) === String(item.id));
                if (index < 0) return fail('이미 삭제된 항목이에요. 목록을 다시 확인해 주세요.');
                items[index] = { ...items[index], name, information, memo: values.memo, updatedAt };
            }
            try {
                saveLibrary(items);
            } catch {
                return fail('브라우저 저장 공간이 부족해서 저장하지 못했어요.');
            }
            state.library.draft = null;
            state.library.selected = String(id);
            reloadLibrary(id);
            fillForm(getSelected());
            render();
            toast('보관함에 저장했어요');
            return true;
        }

        async function useInChat(item) {
            const target = state.server;
            if (!item || item.isDraft || item.current || !target.chatId || state.busy) return;
            if (keyOf(item) === target.selected && isDirty()) {
                if (!confirm('저장하지 않은 변경사항이 있어요. 저장한 뒤 이 대화에 사용할까요?')) return;
                if (!await save()) return;
                item = getSelected(target);
                if (!item || item.current) return;
            }
            const { id, name } = item;
            setBusy('use');
            try {
                await useServerProfileInChat(target.chatId, id);
                await loadServer().catch(() => {
                    for (const profile of target.items) profile.current = String(profile.id) === String(id);
                });
                toast(`이 대화에서 ‘${name || '이름 없음'}’ 프로필을 사용해요`);
            } catch (error) {
                fail(`이 대화에 적용하지 못했어요. ${error.message}`);
            } finally {
                setBusy('');
                render();
            }
        }

        async function removeSelected() {
            const item = getSelected();
            if (!item || item.isDraft || state.busy) return;
            const label = item.name || '이름 없음';
            if (state.source === 'library') {
                if (!confirm(`‘${label}’ 항목을 보관함에서 삭제할까요?`)) return;
                saveLibrary(loadLibrary().filter((entry) => String(entry.id) !== String(item.id)));
                state.library.selected = null;
                state.baseline = null;
                reloadLibrary();
                fillForm(getSelected());
                setView('list');
                render();
                toast('보관함에서 삭제했어요');
                return;
            }
            if (item.current) {
                fail('이 대화에서 사용 중인 프로필은 삭제할 수 없어요. 다른 프로필을 먼저 사용해 주세요.');
                return;
            }
            if (!confirm(`‘${label}’ 프로필을 크랙에서 삭제할까요? 되돌릴 수 없어요.`)) return;
            const target = state.server;
            setBusy('delete');
            try {
                await deleteServerProfile(target.accountId, item.id);
                target.selected = null;
                state.baseline = null;
                await loadServer().catch(() => {
                    target.items = target.items.filter((profile) => profile !== item);
                    ensureSelection(target);
                    fillForm(getSelected(target));
                });
                setView('list');
                toast('프로필을 삭제했어요');
            } catch (error) {
                fail(`삭제하지 못했어요. ${error.message}`);
            } finally {
                setBusy('');
                render();
            }
        }

        function copyToLibrary() {
            const values = formValues();
            const name = truncate(values.name.trim(), NAME_MAX);
            const information = values.information.trim();
            if (!name && !information) {
                fail('보관함에 담을 내용이 없어요.');
                return;
            }
            const items = loadLibrary();
            if (items.some((entry) => entry.name === name && entry.information === information && String(entry.memo ?? '') === values.memo)) {
                toast('보관함에 같은 내용이 이미 있어요');
                return;
            }
            items.unshift({ id: `lib_${Date.now()}`, name, information, memo: values.memo, updatedAt: new Date().toISOString() });
            try {
                saveLibrary(items);
            } catch {
                fail('브라우저 저장 공간이 부족해서 복사하지 못했어요.');
                return;
            }
            state.library.items = items;
            renderChrome();
            toast(`‘${name || '이름 없음'}’ 내용을 보관함에 복사했어요`);
        }
        function openLibraryPicker(anchor) {
            const entries = loadLibrary();
            if (!entries.length) {
                toast('보관함이 비어 있어요');
                return;
            }
            openMenu(anchor, entries.map((entry) => ({
                label: entry.name || '이름 없음',
                sub: entry.information || '',
                onSelect: () => {
                    el.name.value = truncate(String(entry.name ?? ''), NAME_MAX);
                    el.info.value = String(entry.information ?? '');
                    el.memo.value = String(entry.memo ?? '');
                    if (el.memo.value.trim()) state.memoOpen = true;
                    onFormInput();
                    toast('보관함 내용을 불러왔어요. 저장하면 반영돼요');
                },
            })), { label: '보관함에서 불러오기', wide: true });
        }
        async function promoteToServer() {
            const server = state.server;
            if (state.source !== 'library' || state.busy) return;
            if (isDirty()) {
                if (!confirm('저장하지 않은 변경사항이 있어요. 보관함에 저장한 뒤 추가할까요?')) return;
                if (!await save()) return;
            }
            const entry = getSelected();
            if (!entry || entry.isDraft) return;
            const name = String(entry.name ?? '').trim();
            const information = String(entry.information ?? '');
            if (!name) return fail('이름이 있어야 크랙 프로필로 추가할 수 있어요.', el.name);
            if (information.length > INFO_MAX) return fail(`정보가 ${INFO_MAX}자를 넘어서 크랙 프로필로 추가할 수 없어요.`, el.info);
            if (server.status !== 'ready' || !server.accountId) {
                return fail('크랙 프로필 목록을 불러오지 못해서 추가할 수 없어요. 크랙 프로필 탭에서 다시 시도해 주세요.');
            }
            setBusy('promote');
            try {
                const saved = unwrapServerData(await createServerProfile(server.accountId, { name, information }));
                const savedId = saved?._id ?? saved?.id ?? null;
                if (String(entry.memo ?? '').trim()) saveSlotMemos(updateSlotMemo(loadSlotMemos(), { name, memo: String(entry.memo) }));
                state.source = 'server';
                state.query = '';
                el.search.value = '';
                state.baseline = null;
                server.draft = null;
                await loadServer({ preferredId: savedId, preferredName: name }).catch(() => {
                    if (savedId != null) applyLocalSave({ isDraft: true }, savedId, { name, information });
                });
                if (!state.baseline) fillForm(getSelected(server));
                setView('list');
                toast(`‘${name}’ 프로필을 크랙에 추가했어요`);
            } catch (error) {
                fail(`크랙 프로필로 추가하지 못했어요. ${error.message}`);
            } finally {
                setBusy('');
                render();
            }
        }
        async function copyAsText() {
            const values = formValues();
            try {
                await navigator.clipboard.writeText(`[이름]\n${values.name}\n\n[정보]\n${values.information}\n\n[메모]\n${values.memo}`);
                toast('이름, 정보, 메모를 복사했어요');
            } catch {
                fail('클립보드에 복사하지 못했어요. 브라우저 권한을 확인해 주세요.');
            }
        }
        function exportLibrary() {
            const blob = new Blob([JSON.stringify({ library: loadLibrary(), memos: loadSlotMemos() }, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `crac_profile_backup_${Date.now()}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast('보관함과 메모를 파일로 저장했어요');
        }
        function importLibrary() {
            const file = el.import.files?.[0];
            el.import.value = '';
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                let data;
                try { data = JSON.parse(reader.result); } catch { return toast('백업 파일을 읽지 못했어요'); }
                const library = Array.isArray(data?.library) ? data.library : null;
                const memos = data?.memos && typeof data.memos === 'object' && !Array.isArray(data.memos) ? data.memos : null;
                if (!library && !memos) return toast('보관함 백업 파일이 아니에요');
                if (!confirm('백업 파일 내용으로 보관함과 메모를 바꿀까요? 지금 보관함에 있는 내용은 사라져요.')) return;
                try {
                    if (library) saveLibrary(library);
                    if (memos) saveSlotMemos(memos);
                } catch {
                    return toast('브라우저 저장 공간이 부족해서 복원하지 못했어요');
                }
                state.library.draft = null;
                state.library.selected = null;
                reloadLibrary();
                if (!isDirty()) fillForm(getSelected());
                render();
                toast('백업 파일에서 복원했어요');
            };
            reader.onerror = () => toast('백업 파일을 읽지 못했어요');
            reader.readAsText(file);
        }

        function closeMenu({ focusAnchor = false } = {}) {
            if (!menu) return;
            const { node, anchor } = menu;
            menu = null;
            node.remove();
            anchor.setAttribute('aria-expanded', 'false');
            if (focusAnchor && anchor.isConnected) anchor.focus({ preventScroll: true });
        }
        function openMenu(anchor, entries, { label = '', wide = false } = {}) {
            const toggling = menu?.anchor === anchor;
            closeMenu();
            if (toggling) return;
            const node = document.createElement('div');
            node.className = `ctm-menu${wide ? ' is-wide' : ''}`;
            node.setAttribute('role', 'menu');
            if (label) node.setAttribute('aria-label', label);
            if (label && wide) {
                const title = document.createElement('div');
                title.className = 'ctm-menu-title';
                title.textContent = label;
                node.appendChild(title);
            }
            for (const entry of entries) {
                if (entry === 'separator') {
                    const line = document.createElement('div');
                    line.className = 'ctm-menu-sep';
                    line.setAttribute('role', 'separator');
                    node.appendChild(line);
                    continue;
                }
                const radio = typeof entry.checked === 'boolean';
                const button = document.createElement('button');
                button.type = 'button';
                button.className = `ctm-menu-item${entry.danger ? ' is-danger' : ''}`;
                button.setAttribute('role', radio ? 'menuitemradio' : 'menuitem');
                if (radio) button.setAttribute('aria-checked', String(entry.checked));
                const lead = radio ? `<span class="ctm-menu-check">${entry.checked ? icon('check') : ''}</span>` : entry.icon ? icon(entry.icon) : '';
                button.innerHTML = `${lead}<span class="ctm-menu-text"><span>${escapeHtml(entry.label)}</span>${entry.sub ? `<span class="ctm-menu-sub">${escapeHtml(entry.sub)}</span>` : ''}</span>`;
                button.addEventListener('click', () => {
                    closeMenu({ focusAnchor: !entry.keepsMenu });
                    entry.onSelect();
                });
                node.appendChild(button);
            }
            root.appendChild(node);
            anchor.setAttribute('aria-expanded', 'true');
            menu = { node, anchor };
            positionMenu(node, anchor);
            node.querySelector('.ctm-menu-item')?.focus({ preventScroll: true });
        }
        function positionMenu(node, anchor) {
            const rect = anchor.getBoundingClientRect();
            const top = viewport ? viewport.offsetTop : 0;
            const height = viewport ? viewport.height : window.innerHeight;
            const width = document.documentElement.clientWidth;
            const margin = 8;
            const gap = 6;
            const below = top + height - rect.bottom - gap - margin;
            const above = rect.top - top - gap - margin;
            const placeBelow = below >= node.offsetHeight || below >= above;
            node.style.maxHeight = `${Math.max(120, Math.floor(placeBelow ? below : above))}px`;
            const menuWidth = node.offsetWidth;
            const menuHeight = node.offsetHeight;
            const left = rect.left + menuWidth > width - margin ? rect.right - menuWidth : rect.left;
            node.style.left = `${Math.max(margin, Math.min(left, width - menuWidth - margin))}px`;
            node.style.top = `${placeBelow ? rect.bottom + gap : rect.top - gap - menuHeight}px`;
        }
        function moveMenuFocus(event) {
            const items = [...menu.node.querySelectorAll('.ctm-menu-item')];
            if (!items.length) return;
            event.preventDefault();
            const index = items.indexOf(document.activeElement);
            const last = items.length - 1;
            const next = event.key === 'Home' ? 0
                : event.key === 'End' ? last
                    : event.key === 'ArrowDown' ? (index + 1) % items.length
                        : (index <= 0 ? last : index - 1);
            items[next].focus();
        }
        function openMoreMenu(anchor) {
            const item = getSelected();
            if (!item) return;
            const entries = [];
            if (state.source === 'server') {
                if (isSheet() && state.server.chatId && !item.isDraft && !item.current) {
                    entries.push({ label: '이 대화에 사용', icon: 'use', onSelect: () => useInChat(getSelected(state.server)) });
                }
                entries.push({ label: '보관함에 복사', icon: 'archive', onSelect: copyToLibrary });
                entries.push({ label: '보관함에서 불러오기', icon: 'inbox', keepsMenu: true, onSelect: () => openLibraryPicker(anchor) });
            } else {
                if (isSheet() && !item.isDraft) entries.push({ label: '크랙 프로필로 추가', icon: 'userPlus', onSelect: promoteToServer });
                entries.push({ label: '텍스트로 복사', icon: 'copy', onSelect: copyAsText });
            }
            if (!item.isDraft) {
                entries.push('separator', {
                    label: state.source === 'server' ? '크랙에서 삭제' : '보관함에서 삭제', icon: 'trash', danger: true, onSelect: removeSelected,
                });
            }
            openMenu(anchor, entries, { label: '더보기' });
        }
        function openSortMenu(anchor) {
            const target = store();
            const options = state.source === 'server' ? SERVER_SORT_OPTIONS : LIBRARY_SORT_OPTIONS;
            openMenu(anchor, options.map((option) => ({
                label: option.label,
                checked: option.value === target.sort,
                onSelect: () => {
                    target.sort = option.value;
                    renderList();
                },
            })), { label: '정렬' });
        }
        function openLibraryTools(anchor) {
            openMenu(anchor, [
                { label: '파일로 백업', icon: 'download', onSelect: exportLibrary },
                { label: '백업 파일에서 복원', icon: 'upload', onSelect: () => { if (confirmDiscard()) el.import.click(); } },
            ], { label: '보관함 백업·복원' });
        }

        function requestClose() {
            if (!confirmDiscard('저장하지 않은 변경사항이 있어요. 닫을까요?')) return;
            if (host) {
                closeHostDialog();
                return;
            }
            cleanup();
            root.remove();
            if (returnFocus?.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus({ preventScroll: true });
        }
        // 크랙 창은 크랙이 닫게 두고, 닫힌 뒤 정리는 창 감시(syncProfileDialog)가 맡는다.
        function closeHostDialog() {
            closeMenu();
            allowNativeEscape = true;
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
            allowNativeEscape = false;
            setTimeout(() => {
                if (!root.isConnected || !host.isConnected || host.dataset.state === 'closed') return;
                const nativeClose = [...host.querySelectorAll('button')].find((button) => !root.contains(button)
                    && /닫기|close/i.test(`${button.getAttribute('aria-label') || ''} ${button.textContent}`));
                if (nativeClose) {
                    nativeClose.click();
                } else {
                    // 크랙 창을 닫지 못하면 원래 화면이라도 쓸 수 있게 편집기를 걷어 내고 크랙 창을 다시 보인다.
                    showHostDialog();
                    cleanup();
                    root.remove();
                }
            }, 150);
        }
        // 크랙 창과 그 어두운 배경은 뒤에 열어 둔 채 보이지 않게 한다.
        function hideHostDialog() {
            host.dataset.ctmHosted = '';
            const previous = host.previousElementSibling;
            if (previous && getComputedStyle(previous).position === 'fixed') {
                hostOverlay = previous;
                hostOverlay.dataset.ctmHostedOverlay = '';
            }
        }
        function showHostDialog() {
            delete host.dataset.ctmHosted;
            if (hostOverlay) delete hostOverlay.dataset.ctmHostedOverlay;
        }
        // 크랙 창의 포커스 가두기가 이 편집기 입력칸에서 포커스를 도로 빼앗지 않게 한다.
        function onFocusOutCapture(event) {
            if (event.relatedTarget && root.contains(event.relatedTarget)) event.stopPropagation();
        }
        function onEscapeCapture(event) {
            if (event.key !== 'Escape' || allowNativeEscape || !root.isConnected) return;
            // 크랙 창의 Esc 처리보다 먼저 받아서 메뉴 닫기, 뒤로 가기, 저장 확인을 거친다.
            event.stopPropagation();
            if (event.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            if (menu) closeMenu({ focusAnchor: true });
            else if (isSheet() && state.view === 'detail') goBack();
            else requestClose();
        }
        function trapFocus(event) {
            const focusable = [...panel.querySelectorAll('button, input, textarea')]
                .filter((node) => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length > 0);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
        // 화면 키보드가 올라오면 보이는 영역에 맞춰 시트 높이를 줄인다.
        function syncViewport() {
            if (!viewport || Math.abs(viewport.scale - 1) > 0.01) {
                root.style.removeProperty('--ctm-vv-top');
                root.style.removeProperty('--ctm-vv-height');
                return;
            }
            root.style.setProperty('--ctm-vv-top', `${viewport.offsetTop}px`);
            root.style.setProperty('--ctm-vv-height', `${viewport.height}px`);
        }
        function keepFieldVisible(event) {
            const field = event.target;
            if (!isSheet() || !el.editor.contains(field) || !field.matches('input, textarea')) return;
            setTimeout(() => {
                if (document.activeElement !== field) return;
                const box = el.editor.getBoundingClientRect();
                const rect = field.getBoundingClientRect();
                if (rect.top < box.top) el.editor.scrollTop -= box.top - rect.top + 12;
                else if (rect.bottom > box.bottom) el.editor.scrollTop += Math.min(rect.bottom - box.bottom + 12, rect.top - box.top - 12);
            }, 320);
        }
        function onWindowResize() {
            closeMenu();
            syncViewport();
        }
        function onSheetChange() {
            closeMenu();
            render();
        }
        function cleanup() {
            closeMenu();
            viewport?.removeEventListener('resize', syncViewport);
            viewport?.removeEventListener('scroll', syncViewport);
            window.removeEventListener('resize', onWindowResize);
            window.removeEventListener('keydown', onEscapeCapture, true);
            window.removeEventListener('focusout', onFocusOutCapture, true);
            sheetQuery.removeEventListener?.('change', onSheetChange);
            if (hostedRoot === root) hostedRoot = null;
        }

        function onClick(event) {
            if (event.target === overlay) {
                if (pointerStartedOnBackdrop) requestClose();
                return;
            }
            const control = event.target.closest('[data-action]');
            if (!control || !root.contains(control) || control.disabled) return;
            const key = control.closest('.ctm-pm-row')?.dataset.key;
            switch (control.dataset.action) {
                case 'close': requestClose(); break;
                case 'toggle-search':
                    state.searchOpen = !root.classList.contains('is-search-open');
                    if (!state.searchOpen) {
                        state.query = '';
                        el.search.value = '';
                    }
                    render();
                    if (state.searchOpen) el.search.focus();
                    break;
                case 'tab': switchSource(control.dataset.source); break;
                case 'sort': openSortMenu(control); break;
                case 'pick': select(key); break;
                case 'use': useInChat(key ? findItem(key, state.server) : getSelected(state.server)); break;
                case 'retry': startServerLoad(); break;
                case 'new': startDraft(); break;
                case 'library-tools': openLibraryTools(control); break;
                case 'back': goBack(); break;
                case 'more': openMoreMenu(control); break;
                case 'promote': promoteToServer(); break;
                case 'memo':
                    state.memoOpen = !state.memoOpen;
                    renderDetail();
                    if (state.memoOpen && !el.memo.value) el.memo.focus();
                    break;
                case 'save': save(); break;
                case 'revert': revert(); break;
                default: break;
            }
        }
        function onKeydown(event) {
            if (event.isComposing || event.keyCode === 229) return;
            if (menu && menu.node.contains(event.target) && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                moveMenuFocus(event);
                return;
            }
            if (event.key === 'Tab') {
                if (menu) {
                    event.preventDefault();
                    closeMenu({ focusAnchor: true });
                } else {
                    trapFocus(event);
                }
                return;
            }
            if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS' && isEditorVisible()) {
                event.preventDefault();
                save();
            }
        }

        overlay.addEventListener('pointerdown', (event) => { pointerStartedOnBackdrop = event.target === overlay; });
        root.addEventListener('pointerdown', (event) => {
            if (menu && !menu.node.contains(event.target) && !menu.anchor.contains(event.target)) closeMenu();
        }, true);
        root.addEventListener('scroll', (event) => {
            if (menu && !menu.node.contains(event.target)) closeMenu();
        }, true);
        root.addEventListener('click', onClick);
        root.addEventListener('keydown', onKeydown);
        root.addEventListener('focusin', keepFieldVisible);
        // 사이트의 단축키, 포커스 가두기, 바깥 클릭 닫기가 이 창의 입력을 가로채지 않게 한다.
        for (const type of ['pointerdown', 'mousedown', 'touchstart', 'touchmove', 'wheel', 'focusin', 'focusout', 'keydown', 'keyup']) {
            root.addEventListener(type, (event) => event.stopPropagation(), { passive: true });
        }
        root.querySelector('.ctm-pm-tabs').addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const next = state.source === 'server' ? 'library' : 'server';
            switchSource(next);
            root.querySelector(`.ctm-pm-tab[data-source="${next}"]`)?.focus();
        });
        el.search.addEventListener('input', () => {
            state.query = el.search.value;
            root.classList.toggle('is-search-open', state.searchOpen || Boolean(state.query));
            renderList();
        });
        for (const field of [el.name, el.info, el.memo]) field.addEventListener('input', onFormInput);
        el.import.addEventListener('change', importLibrary);
        viewport?.addEventListener('resize', syncViewport);
        viewport?.addEventListener('scroll', syncViewport);
        window.addEventListener('resize', onWindowResize);
        window.addEventListener('keydown', onEscapeCapture, true);
        window.addEventListener('focusout', onFocusOutCapture, true);
        sheetQuery.addEventListener?.('change', onSheetChange);
        root._ctmCleanup = cleanup;
        if (host) hideHostDialog();

        syncViewport();
        ensureSelection(state.library);
        if (state.source === 'library') fillForm(getSelected());
        render();
        (isSheet() ? panel : el.search).focus({ preventScroll: true });
        startServerLoad();
    }

    // 사이트의 '대화 프로필' 제목 옆에는 관리 버튼 하나만 둔다.
    function syncUi() {
        if (document.getElementById(UI.entryId)) return;
        const titleEl = [...document.querySelectorAll('p[color="text_primary"]')]
            .find((el) => el.textContent.length <= 40 && el.textContent.includes('대화 프로필'));
        if (!titleEl) return;
        ensureStyles();
        let btnGroup = titleEl.querySelector('.persona-btn-group');
        if (!btnGroup) {
            btnGroup = document.createElement('span');
            btnGroup.className = 'persona-btn-group';
            btnGroup.style.cssText = 'display:inline-flex; align-items:center; flex-wrap:wrap; margin-left:8px; gap:6px;';
            titleEl.appendChild(btnGroup);
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.id = UI.entryId;
        button.className = 'ctm-inline-action';
        button.textContent = '관리';
        button.title = '대화 프로필 편집과 보관함';
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openProfileManager();
        });
        btnGroup.appendChild(button);
    }

    // 크랙의 '대화 프로필' 창(원본 편집기가 바꾸던 창)을 찾는다. 제목 옆에 넣은 관리 버튼 글자는 빼고 비교한다.
    function findProfileDialog() {
        return [...document.querySelectorAll('[role="dialog"]')].find((dialog) => {
            if (dialog.closest('.ctm-ui-root') || dialog.hidden || dialog.dataset.state === 'closed') return false;
            const title = dialog.querySelector('h2');
            if (!title) return false;
            const injected = title.querySelector('.persona-btn-group')?.textContent || '';
            return title.textContent.replace(injected, '').trim() === PROFILE_DIALOG_TITLE;
        });
    }

    // 크랙 창이 열리면 그 안에 편집기를 띄우고, 닫히거나 사라지면 정리한다.
    function syncProfileDialog() {
        const mounted = hostedRoot;
        if (mounted) {
            const host = mounted._ctmHost;
            if (mounted.isConnected && host?.isConnected && !host.hidden && host.dataset.state !== 'closed') return;
            // 크랙 창은 닫히는 동안에도 숨김 표시가 남아 있어 원래 내용이 비치지 않는다.
            mounted._ctmCleanup?.();
            mounted.remove();
        }
        const dialog = findProfileDialog();
        if (dialog) openProfileManager({ host: dialog });
    }

    function startUi() {
        // 채팅이 스트리밍될 때 매 변경마다 문서를 훑지 않도록 관리 버튼 확인은 모아서 한다.
        let timer = null;
        const observer = new MutationObserver(() => {
            // 크랙 창은 그려지기 전에 바꿔야 원래 화면이 깜빡이지 않는다.
            syncProfileDialog();
            if (timer) return;
            timer = setTimeout(() => {
                timer = null;
                syncUi();
            }, 150);
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-state', 'hidden'],
        });
        syncProfileDialog();
        syncUi();
    }

    if (document.body) startUi();
    else document.addEventListener('DOMContentLoaded', startUi, { once: true });
})();
