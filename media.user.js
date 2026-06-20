// ==UserScript==
// @name         크랙 미디어 설정 툴바 Beta
// @namespace    http://tampermonkey.net/
// @version      1,0
// @description  구제작 미디어 편의성
// @author       뤼붕이
// @match        *://crack.wrtn.ai/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 1. 힌트창 숨김을 위한 최소한의 CSS
    const style = document.createElement('style');
    style.textContent = `
        /* 힌트 컨테이너만 정확히 숨김 */
        body.tm-hide-hints .tm-hint-container {
            display: none !important;
        }

        /* 힌트 끄기/켜기 버튼 스타일 */
        .tm-hint-btn {
            background-color: #374151;
            color: white;
            border: none;
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 13px;
            font-weight: bold;
            cursor: pointer;
            margin-left: 8px;
            transition: 0.2s;
            height: 36px;
        }
        .tm-hint-btn:hover { background-color: #4b5563; }
    `;
    document.head.appendChild(style);

    // 2. 힌트창 식별 클래스 부여 (다른 입력칸이 숨겨지는 버그 방지)
    function tagHintContainers() {
        const hintTexts = Array.from(document.querySelectorAll('p')).filter(p => p.textContent.trim() === '이미지 힌트');
        hintTexts.forEach(p => {
            const container = p.closest('.w-full.px-5');
            if (container && !container.classList.contains('tm-hint-container')) {
                container.classList.add('tm-hint-container');
            }
        });
    }

    // 3. [이미지 생성] 버튼 옆에 '힌트 끄기' 버튼 삽입
    function injectHintToggle() {
        if (document.getElementById('tm-hint-toggle')) return;

        // 전체 버튼 중 '이미지 생성' 텍스트를 가진 버튼 찾기 (상단 상황이미지 헤더 부분)
        const allButtons = Array.from(document.querySelectorAll('button'));
        const genBtn = allButtons.find(b => b.textContent.trim() === '이미지 생성');

        // 해당 버튼이 존재하면 바로 그 부모 요소에 버튼 추가 (이미지 생성 버튼 옆에 붙음)
        if (genBtn && genBtn.parentElement) {
            const toggleBtn = document.createElement('button');
            toggleBtn.id = 'tm-hint-toggle';
            toggleBtn.className = 'tm-hint-btn';
            toggleBtn.textContent = '👁️ 힌트 끄기';

            toggleBtn.onclick = (e) => {
                e.preventDefault();
                const isHidden = document.body.classList.toggle('tm-hide-hints');
                toggleBtn.textContent = isHidden ? '👁️ 힌트 켜기' : '👁️ 힌트 끄기';
            };

            genBtn.parentElement.appendChild(toggleBtn);
        }
    }

    // 4. [코드 복사] 옆에 ➕ 퀵 추가 버튼 삽입 (유지 요청하신 기능)
    function injectPlusButtons() {
        const btnGroups = document.querySelectorAll('.css-4ry7o9'); // 이미지 변경, 코드 복사 묶음 영역
        btnGroups.forEach(group => {
            if (group.dataset.tmInjected) return;
            group.dataset.tmInjected = 'true';

            const plusBtn = document.createElement('button');
            plusBtn.className = 'relative inline-flex items-center justify-center gap-1 overflow-hidden whitespace-nowrap font-medium transition-colors duration-200 h-6 rounded px-3 py-1 text-xs bg-emerald-500 text-white hover:bg-emerald-600 active:bg-emerald-700';
            plusBtn.textContent = '➕ 추가';
            plusBtn.style.marginLeft = '4px';

            plusBtn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();

                const scrollArea = document.querySelector('.build-scroll-form');
                if(!scrollArea) return;

                // 상황 이미지 추가(기기에서 가져오기/라이브러리)를 띄우는 진짜 버튼 찾기
                const allBtns = Array.from(scrollArea.querySelectorAll('button'));
                const realAddBtn = allBtns.reverse().find(b =>
                    !b.closest('.css-1j99v99') && (b.textContent.includes('추가') || b.querySelector('svg'))
                );

                if(realAddBtn) {
                    realAddBtn.click();
                    // 창 뜨고 나면 새 슬롯 위치로 스크롤 미리 쏴줌
                    setTimeout(() => { scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior: 'smooth' }); }, 100);
                }
            };
            group.appendChild(plusBtn);
        });
    }

    // 변경사항 감지용 1.5초 루프 (튕김 원인인 MutationObserver 대신 사용)
    setInterval(() => {
        tagHintContainers();
        injectHintToggle();
        injectPlusButtons();
    }, 1500);

})();
