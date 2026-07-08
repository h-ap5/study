// ==UserScript==
// @name         Crack Muse Writer (AI 답변 커스텀 + 번역) ✨
// @namespace    muse writer
// @version      4.0.0
// @description  Crack 캐릭터챗 입력을 맥락·프로필·방별 설정에 맞춰 다듬거나 이어 쓰고, 캐릭터 맞춤 번역까지 한 곳에서 처리하는 AI 집필 보조 도구 (Scene Painter 테마 호환)
// @match        https://crack.wrtn.ai/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      generativelanguage.googleapis.com
// @connect      api.deepseek.com
// ==/UserScript==

(function () {
  "use strict";

  const API_BASE = "https://crack-api.wrtn.ai/crack-gen";
  const API_ORIGIN = "https://crack-api.wrtn.ai";

  let generatedHistory = [];
  let historyIndex = -1;

  // 출력 분량 다이얼: level → {표시 라벨, 목표 글자수}
  const LEN_PRESETS = {
    1: { label: "짧게 (1~2문장, 약 100자)", chars: 100 },
    2: { label: "보통 (3~4문장, 약 250자)", chars: 250 },
    3: { label: "길게 (1문단, 약 450자)", chars: 450 },
    4: { label: "아주 길게 (2~3문단, 약 700자)", chars: 700 },
    5: { label: "최대 (4문단+, 약 1100자)", chars: 1100 },
  };

  const MOAN_TONE_INSTRUCTION = "[신음] 박힐 때마다 숨을 끊어 가쁜 호흡을 표현할 것. 대사 사이에 짧은 신음(흐윽, 하앗, 읏 등)을 섞고, 쾌감이 짙어질수록 장음을 활용해 발음이 흐트러지는 것을 묘사할 것. 특수기호(♡, !)로 쾌감을 시각화하되, 현재 상황(수치심, 억눌림, 애원, 절정, 탈력 등)과 쾌감의 강도에 맞춰 신음의 톤과 빈도를 다채롭게 조절할 것.";

  // 분위기 칩별 연출 방향 (AI 자율 확보). 신음은 별도 MOAN 상수로 처리.
  const TONE_DETAILS = {
    "로맨스": "[로맨스] 설렘, 호감, 망설임이 대사와 시선, 거리감, 작은 반응에 은근히 배어나게. 관계의 속도와 온도는 현재 맥락에 맞춘다.",
    "코믹": "[코믹] 상황의 어긋남, 타이밍, 엉뚱한 반응으로 가볍게 웃음을 만든다. 장면의 감정선을 깨지 않는 선에서 사용한다.",
    "액션": "[액션] 짧은 호흡, 선명한 동작, 즉각적인 반응으로 속도감을 살린다. 긴박함은 상황의 위험도에 맞춰 조절한다.",
    "스릴러": "[스릴러] 위협의 실체를 한 번에 드러내기보다, 불안한 낌새와 압박감이 점차 조여오게 한다.",
    "공포": "[공포] 소리, 어둠, 정적, 낯선 감각처럼 설명되지 않는 불쾌함을 활용해 서늘한 분위기를 만든다.",
    "피폐": "[피폐] 절망, 체념, 균열이 인물의 말투와 선택에 스며들게 한다. 감정은 과장보다 누적되는 무너짐을 우선한다.",
    "관능적": "[관능적] 노골적인 설명보다 감각, 긴장, 시선, 호흡의 변화로 은밀한 열기를 만든다. 분위기는 현재 관계성과 수위에 맞춘다.",
    "일상": "[일상] 사소한 행동, 익숙한 공간, 평범한 대화 속에서 자연스러운 생활감을 살린다.",
    "몽환적": "[몽환적] 현실감이 살짝 흐려지는 이미지, 감각, 리듬을 섞어 아련하고 비현실적인 분위기를 만든다.",
    "애절함": "[애절함] 후회, 그리움, 닿지 못하는 마음이 말과 침묵 사이에 배어나게 한다. 감정은 억지로 폭발시키지 않는다.",
    "블랙코미디": "[블랙코미디] 비극적인 상황과 건조한 웃음, 자조, 부조리를 함께 둔다. 웃기지만 씁쓸한 뒷맛을 남긴다.",
    "사극": "[사극] 전근대 동양 시대극의 말투, 예법, 거리감, 공기를 반영한다. 현대어와 외래어는 필요할 때만 매우 조심스럽게 피한다.",
    "무협": "[무협] 강호의 의리, 체면, 은원, 결투의 기세를 살린다. 말과 행동에 비장함과 무게를 둔다.",
    "힐링": "[힐링] 다그치기보다 천천히 감싸는 온기를 둔다. 위로는 직접 설명하기보다 행동과 분위기 속에 자연스럽게 녹인다.",
    "서스펜스": "[서스펜스] 큰 사건 없이도 침묵, 어긋난 말, 미묘한 위화감으로 조용한 긴장을 쌓는다.",
  };


  // 문체 드롭다운별 서술 방식. 기본은 별도 문체 강제 없음.
  const STYLE_DETAILS = {
    "기본": "",
    "회고체": "[회고체] 1인칭 고정. 자칭은 '저/제'만 사용하고 '나/내'는 쓰지 않는다.\n\n서술의 기준점은 사건이 벌어지는 순간이 아니라, 그것을 지금 되짚어 말하는 시점에 둔다. 사건 자체는 현재 진행 중인 장면으로 다루되, 행동 묘사와 내면 서술은 지나간 순간을 돌아보는 어조로 쓴다. 대사는 이 규칙과 무관하게 캐릭터의 현재 발화로 자연스럽게 유지한다.\n\n문장 종결은 존댓말 회고 어조를 기본으로 하되, 같은 종결을 연달아 반복하지 않고 문장마다 형태를 다양하게 굴린다. 평어체 종결로 돌아가는 것만 금지한다.\n\n한 장면 안에서 최소 한 번은, 그 순간과 지금 사이에 생긴 인식의 차이를 드러낸다. 그때는 몰랐던 것이 지금은 분명해졌다는 감각, 당시엔 사소했던 것이 돌아보니 의미를 가지게 되었다는 감각을 문장에 흐릿하게 남긴다. 특정 문형이나 회상 표지를 반복해 양식처럼 보이게 만들지 않는다.\n\n겉으로 드러낸 모습과 속마음 사이의 낙차를 드러낼 때는, 그 감정에 이유를 붙여 해명하거나 정리하지 않는다. 설명 없이 감정만 짧게 흘리되, 문장은 문법적으로 완결한다. 이 장치는 장면당 한두 번만 절제해서 쓴다.\n\n사건을 요약하거나 결론처럼 닫지 않는다. 다만 마지막 문장은 미완성된 절이나 관형형으로 끊지 않고, 문법적으로 완결된 문장으로 마무리한다. 장면의 진행감은 유지한 채, 말하지 못한 마음과 남은 감각이 조용히 따라붙는 여운으로 쓴다. PC의 행동량과 전개 강도는 기존 능동성 지침을 우선한다.",
    "유보체": "[유보체] 서술은 단정적인 감정 해석을 피하고, 확신을 조금 유보하는 어조로 쓴다. 행동과 장면의 사실관계는 선명하게 서술하되, 감정·의도·자기 이해를 말할 때는 “그런 것 같다”, “그랬을지도 모른다”, “그랬던가”, “그랬겠지”, “아마도”처럼 여지를 남기는 표현을 자연스럽게 섞는다. 같은 어미를 연달아 반복하지 않고 문장마다 형태를 다양하게 굴린다.\n\n감정이나 속마음을 드러낼 때는 곧장 인정하지 않는다. 먼저 무심하게 넘기거나 부정하는 태도를 보인 뒤, 바로 뒤이어 그 부정을 스스로 흔드는 문장을 붙인다. 독자는 화자가 부정하는 감정이 사실에 가깝다는 것을 그 흔들림으로 눈치챌 수 있어야 하지만, 화자 자신은 끝까지 그 감정을 완전히 단정하지 않는다.\n\n문어체 서술 사이에 “뭐”, “말이다”, “그런데”, “아무튼” 같은 구어체 추임새를 간간이 섞어, 화자가 자기 이야기를 조금 남 일처럼 들려주는 인상을 만든다. 다만 추임새는 장면당 두세 번 안쪽으로 절제하고, 분위기를 깨뜨릴 만큼 자주 쓰지 않는다.\n\n사건이나 감정을 명확한 결론으로 정리하지 않는다. 마지막 문장은 문법적으로 완결하되, 감정의 해답을 닫아버리기보다 아직 다 인정하지 못한 마음이나 남은 감각이 따라붙는 방식으로 여지를 남긴다.",
    "위트비유체": "[위트비유체] 서술은 과장되고 유쾌한 비유와 밈적 감각을 활용하되, 비유와 드립의 소재는 현재 장면 안에 있거나 PC가 그 순간 자연스럽게 떠올릴 법한 대상에서 가져온다. 엉뚱함은 허용하지만, 장면과 아무 접점 없는 소재를 갑자기 끌어오지 않는다.\n\n비유는 사물이나 상황을 조금 삐딱하고 재치 있게 바라보는 방식으로 사용한다. 평범한 행동도 PC의 성격에 맞춰 살짝 과장하거나 비틀어 표현할 수 있다. 다만 비유가 장면보다 앞서 나가거나, 독자가 실제 상황을 헷갈릴 정도로 튀어서는 안 된다.\n\n밈은 단순히 인터넷 유행어를 그대로 붙이는 방식이 아니라, 상황을 과장하고 비틀어 짧게 압축하는 감각으로 사용한다. PC가 지금 겪는 상황을 어딘가 익숙하게 웃긴 구조로 바라보되, 장면의 세계관과 캐릭터가 알 법한 말투 안에서 자연스럽게 변형한다.\n\n특정 밈, 유행어, 현대적 표현을 직접 사용할 때는 PC가 그것을 알 만한 배경인지, 현재 장면의 분위기를 깨지 않는지 먼저 고려한다. 맞지 않는 장면에서는 밈의 원문을 그대로 쓰지 말고, 그 밈이 가진 리듬이나 구조만 빌려와 장면 안의 사물·상황·말투로 바꿔 쓴다.\n\n예를 들어 밈적 감각은 갑작스러운 과장, 진지한 상황을 살짝 비트는 자조, 너무 정확해서 웃긴 비유, 현실을 받아들이기 싫어하는 짧은 회피 반응, 속으로만 하는 어이없는 태클처럼 처리할 수 있다. 다만 이 감각이 장면을 망가뜨리는 개그 쇼처럼 보이면 안 된다.\n\n비유와 밈은 한 문장 안에서 한 겹만 사용한다. 하나의 상황을 하나의 대상이나 하나의 드립 구조에 빗대는 선에서 멈추고, 비유 위에 다시 비유를 얹거나 서로 다른 소재를 한 문장 안에 여러 개 겹치지 않는다. 문장이 산만해지면 가장 선명한 하나만 남긴다.\n\n가벼운 장면에서는 밈적 비유가 웃음이나 리듬을 만들 수 있다. 그러나 심각한 장면이나 감정의 무게가 큰 장면에서는 목적을 웃기는 것에서, 상황의 핵심을 짧고 날카롭게 짚는 것으로 바꾼다. 이때의 드립은 장면의 무게를 덜어내기보다, 오히려 그 무게를 비틀어 더 선명하게 보여주는 방식이어야 한다.\n\n해설자나 PC가 심각한 순간에도 습관처럼 유쾌한 비유나 밈적 사고를 떠올릴 수는 있다. 다만 그 반응은 단순한 개그가 아니라, 긴장하거나 당황하거나 감정을 피하려는 태도로 읽히게 한다. 필요할 때는 PC 스스로도 자신이 이런 식으로 상황을 비틀어 받아들이고 있다는 점을 희미하게 자각하게 한다.\n\n심각한 장면에서 비유와 밈적 어조를 완전히 배제하고 건조한 어조로만 바꾸지는 않는다. 동시에 죽음, 이별, 상처, 공포처럼 무거운 순간에 억지로 웃긴 소재나 인터넷식 드립을 끼워 넣어 분위기를 망치지 않는다. 그런 장면에서는 현재 감정과 맞닿은 사물, 몸의 반응, 공간의 분위기에서 비유를 고르고, 드립은 자조나 회피의 결로 낮춘다.\n\n같은 종류의 비유나 밈 구조를 연달아 반복하지 않는다. 밈식 과장, 사물 의인화, 관용구, 동물 비유, 자조적 농담, 갑작스러운 현실 태클, 반어적 칭찬, 과장된 비교를 계속 같은 방식으로 쓰지 말고, 장면에 맞춰 표현 방식을 바꾼다.\n\n밈을 사용할 때도 원래 전달하려던 사실, 행동, 감정은 바로 읽혀야 한다. 밈은 문장의 목적이 아니라 보조 장치다. 독자가 드립은 이해했지만 장면의 감정이나 행동을 놓치게 만들면 안 된다.\n\n전체적으로는 PC가 세상을 조금 삐딱하고 유쾌하게 받아들이는 문체를 유지한다. 그 유쾌함은 아무 말 대잔치가 아니라, 현재 상황과 감정선을 더 잘 보이게 만드는 방식으로 사용한다. 웃기기 위해 장면을 희생하지 말고, 장면을 더 선명하게 만들기 위해 웃음과 비틀림을 사용한다.",
  };

  // 문체 예시 툴팁. 기본은 예시 없음.
  const STYLE_EXAMPLES = {
    "회고체": `*그때의 저는, 그 시선이 왜 오래 마음에 남았는지 알지 못했습니다. 그저 유리잔을 내려놓는 손끝이 조금 느려졌고, 빗소리가 이상하리만치 선명하게 들렸을 뿐입니다.*`,
    "유보체": `*긴장한 것은 아니었다. 아마도 아니었을 것이다. 다만 손끝이 자꾸만 소매 안쪽을 문지르고 있었고, 그게 조금 우스웠다. 뭐, 그런 날도 있는 법이니까.*`,
    "위트비유체": `*괜찮다고 말하려 했지만, 표정은 이미 회의에서 혼자 안건을 반대한 신입처럼 굳어 있었다. 뭐, 마음이라는 게 원래 제 주인을 제일 먼저 팔아넘기는 법이니까.*`,
  };

  const CRACK_MARKDOWN_INSTRUCTION = "[Crack Markdown 렌더링 운용 지침 — 활성화됨]\n- 이 지침이 켜져 있는 동안에는 앞선 [출력 형식]의 '평문 본문 위주' 기본값보다 이 마크다운 운용 지침을 우선 적용하십시오. 일반 서술은 평문으로 자연스럽게 쓰되, 화면에서 분리되어 보일수록 살아나는 구간(문자·채팅·공지·기록·문서·상태창·시스템 메시지·강조 인용 등)에는 Crack에서 실제 렌더되는 Markdown을 망설이지 말고 적극적으로 사용하십시오.\n- 현재 채팅방이 지금까지 평문 위주였더라도, 위와 같은 구간이 나오면 마크다운을 새로 도입해도 됩니다. '이 방은 평소 마크다운을 안 쓰니 나도 안 쓴다'는 식으로 위축되지 마십시오. 다만 한 답변 안에서 제목·표·코드블록을 의미 없이 도배하지는 말고, 분리 표현이 정말 어울리는 곳에만 쓰십시오.\n- 정보의 성격에 맞는 컨테이너를 고르십시오. 본문과 분리된 발화(인용·문자·채팅·공지)는 blockquote(>), 장면 구분·문서 제목은 heading(#), 항목 정리는 list, 비교·스탯·일정·요약은 table, 원문 보존이 필요한 기록·로그·문서·시스템 출력은 codeblock을 쓰십시오.\n- 답변 전체를 하나의 코드블록으로 감싸지 마십시오. 코드블록은 '본문 속에 삽입된 별도 자료(극중 문서·로그·보고서·안내문·시스템 메시지)'로 읽혀야 하는 구간에만 쓰십시오.\n- Crack에서 실제 렌더되는 Markdown만 사용하십시오: #~###### 제목(# 뒤 공백 필요), > / >> / >>> 인용과 중첩 인용, 인용 안 제목·이미지·리스트·체크박스, **굵게**, *기울임*, ***굵은 기울임***, ~~취소선~~, 링크, 이미지, 목록, 체크박스, GFM 표, inline code, 언어명 코드블록, --- / *** / ___ 가로선, $...$ / $$...$$ 수식, [^1] 각주.\n- HTML 태그, x^2^, H~2~O, ==하이라이트== 처럼 Crack에서 렌더되지 않는 문법은 그대로 글자로 노출되므로 쓰지 말고 지원되는 문법으로 대체하십시오.\n- 이미지·링크는 사용자 입력이나 이전 맥락에 실제로 존재하는 URL만 재사용하고, 없는 주소를 추측해 새로 만들지 마십시오.\n- 출력 전, 굵게/기울임/취소선/코드블록/수식/각주/링크/이미지의 여닫는 기호를 모두 닫았는지, 표의 헤더·구분선·열 수가 맞는지, 코드블록 fence가 짝지어졌는지 점검하십시오.";

  // API 요금 계산용 모델별 가격 (USD / 1M tokens)
  const MODEL_PRICING = {
    "gemini-3.1-flash-lite-preview": { input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0.25 },
    "gemini-3-flash-preview": { input: 0.5, output: 3.0, cacheRead: 0.05, cacheWrite: 0.5 },
    "gemini-3.5-flash": { input: 1.5, output: 9.0, cacheRead: 0.15, cacheWrite: 1.5 },
    "gemini-2.5-pro": { input: 1.25, output: 10.0, cacheRead: 0.125, cacheWrite: 1.25 },
    "gemini-2.5-flash": { input: 0.075, output: 0.3, cacheRead: 0.01875, cacheWrite: 0.075 },
    "gemini-3.1-pro-preview": { input: 2.0, output: 12.0, cacheRead: 0.2, cacheWrite: 2.0 },
    "deepseek-v4-flash": { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0.14 },
    "deepseek-v4-pro": { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0.435 },
  };

  const PROVIDER_MODEL_OPTIONS = {
    google: [
      ["gemini-3.5-flash", "Gemini 3.5 Flash"],
      ["gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview"],
      ["gemini-2.5-pro", "Gemini 2.5 Pro"],
      ["gemini-2.5-flash", "Gemini 2.5 Flash"],
    ],
    firebase: [
      ["gemini-3.5-flash", "Gemini 3.5 Flash"],
      ["gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview"],
      ["gemini-2.5-pro", "Gemini 2.5 Pro"],
      ["gemini-2.5-flash", "Gemini 2.5 Flash"],
    ],
    deepseek: [
      ["deepseek-v4-flash", "DeepSeek V4 Flash"],
      ["deepseek-v4-pro", "DeepSeek V4 Pro"],
    ],
  };

  function getProviderKeyName(provider) {
    return provider === "deepseek" ? "deepSeekApiKey" : "apiKey";
  }

  function normalizeUsage(raw) {
    if (!raw || typeof raw !== "object") return null;
    const u = {};
    u.model = raw.model || String(raw.model || "");

    const pick = (keys) => {
      for (const k of keys) {
        const path = String(k).split(".");
        let cur = raw;
        for (const p of path) cur = cur && typeof cur === "object" ? cur[p] : undefined;
        if (typeof cur === "number") return cur;
        if (typeof cur === "string" && !isNaN(Number(cur))) return Number(cur);
      }
      return 0;
    };

    u.inputTokens = pick(["inputTokens", "input_tokens", "promptTokenCount", "prompt_token_count", "promptTokens", "prompt_tokens"]);
    u.outputTokens = pick(["outputTokens", "output_tokens", "candidatesTokenCount", "candidates_token_count", "completion_tokens", "completionTokens"]);
    u.cacheReadInputTokens = pick(["cacheReadInputTokens", "cache_read_input_tokens", "cachedContentTokenCount", "cached_content_token_count", "prompt_cache_hit_tokens", "promptCacheHitTokens"]);
    u.cacheMissInputTokens = pick(["cacheMissInputTokens", "cache_miss_input_tokens", "prompt_cache_miss_tokens", "promptCacheMissTokens"]);
    u.thoughtsTokenCount = pick(["thoughtsTokenCount", "thoughts_token_count", "thinking_tokens", "reasoning_tokens", "completion_tokens_details.reasoning_tokens"]);
    return u;
  }

  function calculateCost(usage, modelOverride = "") {
    const u = usage ? normalizeUsage(usage) : null;
    if (!u) return null;

    const modelIdRaw = u.model || modelOverride;
    const pricing = MODEL_PRICING[modelIdRaw] || MODEL_PRICING[modelOverride] || MODEL_PRICING["gemini-3.5-flash"];
    if (!pricing) return null;

    const thoughtsTokens = u.thoughtsTokenCount || 0;
    const cacheReadTokens = u.cacheReadInputTokens || 0;
    const cacheMissTokens = u.cacheMissInputTokens || 0;
    const totalInputTokens = u.inputTokens || cacheReadTokens + cacheMissTokens || 0;
    const totalOutputTokens = u.outputTokens || 0;
    const actualOutputTokens = thoughtsTokens > 0 && totalOutputTokens >= thoughtsTokens ? totalOutputTokens - thoughtsTokens : totalOutputTokens;
    const uncachedInputTokens = cacheMissTokens > 0 ? cacheMissTokens : Math.max(0, totalInputTokens - cacheReadTokens);

    const readCost = (cacheReadTokens * (pricing.cacheRead ?? pricing.input)) / 1000000;
    const inputCost = (uncachedInputTokens * (pricing.cacheWrite ?? pricing.input)) / 1000000;
    const outputCost = (actualOutputTokens * pricing.output) / 1000000;
    const thoughtsCost = (thoughtsTokens * pricing.output) / 1000000;
    const totalUsd = readCost + inputCost + outputCost + thoughtsCost;

    return {
      usd: totalUsd,
      tokens: { read: cacheReadTokens, input: uncachedInputTokens, output: actualOutputTokens, thoughts: thoughtsTokens },
    };
  }

  function formatUsd(value) {
    const n = Number(value) || 0;
    if (n >= 1) return `$${n.toFixed(4)}`;
    if (n >= 0.01) return `$${n.toFixed(5)}`;
    return `$${n.toFixed(6)}`;
  }

  function getChatRoomId() {
    const match = location.pathname.match(/\/stories\/[^/]+\/episodes\/([^/]+)/);
    return match ? match[1] : "global_room";
  }

  function getLoreActiveKey(room, index) {
    return `loreActive_${room}_${index}`;
  }

  function getLoreTextKey(room, index) {
    return `loreText_${room}_${index}`;
  }

  // =============================================
  // 0. 번역 기능 상수 (구 'AI 캐릭터 맞춤 번역기' 통합)
  //    - API 제공자/모델/키는 집필 기능과 100% 공유한다.
  //    - 이 탭의 설정은 전부 실시간 저장.
  // =============================================
  const TRANS_DEFAULT_FORMAT = "{번역문} ({원문})";

  const TRANS_LANGUAGES = [
    ["English", "영어"],
    ["Japanese", "일본어"],
    ["Chinese (Simplified)", "중국어 간체"],
    ["Chinese (Traditional)", "중국어 번체"],
    ["Russian", "러시아어"],
    ["Spanish", "스페인어"],
    ["French", "프랑스어"],
    ["German", "독일어"],
    ["Italian", "이탈리아어"],
    ["Portuguese", "포르투갈어"],
    ["Vietnamese", "베트남어"],
    ["Thai", "태국어"],
    ["Indonesian", "인도네시아어"],
    ["Arabic", "아랍어"],
    ["Turkish", "터키어"],
    ["Hindi", "힌디어"],
    ["__custom__", "직접 입력…"],
  ];

  function getTargetLang() {
    const lang = GM_getValue("cfgTransLang", "English");
    if (lang === "__custom__") {
      return (GM_getValue("cfgTransCustomLang", "") || "").trim() || "English";
    }
    return lang || "English";
  }

  function getTransFormatTemplate() {
    let fmt = (GM_getValue("cfgTransFormat", TRANS_DEFAULT_FORMAT) || "").trim();
    if (!fmt.includes("{번역문}")) fmt = TRANS_DEFAULT_FORMAT;
    return fmt;
  }

  function buildTransFormatInstruction() {
    const fmt = getTransFormatTemplate();
    const pattern = fmt
      .split("{번역문}").join("<TRANSLATED_DIALOGUE>")
      .split("{원문}").join("<ORIGINAL_KOREAN_DIALOGUE>");
    const example = fmt
      .split("{번역문}").join("Hello, nice to meet you!")
      .split("{원문}").join("안녕, 반가워!");
    return { pattern, example, includesOriginal: fmt.includes("{원문}") };
  }

  // =============================================
  // 1. 스타일 (✍️ 아이콘 버튼 / 🌐 번역 버튼 / 라이트 테마 대응)
  // =============================================
  GM_addStyle(`
        /* 상단 ✍️ 집필 설정 버튼 (아이콘 전용) */
        .crack-pure-settings { height: 2.25rem; width: 2.25rem; min-width: 2.25rem; padding: 0; border-radius: 8px; border: 1px solid hsl(var(--border)); background-color: transparent !important; color: hsl(var(--foreground)); font-size: 16px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; margin-right: 4px; transition: all 0.2s; white-space: nowrap; overflow: hidden; }
        .crack-pure-settings:hover { background-color: hsl(var(--accent)) !important; }

        /* === 전송 버튼 좌측 그룹 (margin-left:auto 로 우측 정렬 고정) === */
        #crack-pure-send-left-group { display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: auto; margin-right: 6px; }
        .crack-pure-magic { height: 1.75rem; width: 1.75rem; min-width: 1.75rem; border-radius: 9999px; background-color: #6A3DE8; color: white; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border: none; padding: 0; box-shadow: 0 4px 6px var(--shadow-md); transition: all 0.2s; }
        .crack-pure-magic:hover { transform: scale(1.1); background-color: #5228CC; }

        /* 🌐 번역 버튼 */
        .crack-pure-trans { height: 1.75rem; width: 1.75rem; min-width: 1.75rem; border-radius: 9999px; background-color: #2E86DE; color: white; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border: none; padding: 0; box-shadow: 0 4px 6px var(--shadow-md); transition: all 0.2s; }
        .crack-pure-trans:hover { transform: scale(1.1); background-color: #1B6FC4; }

        .crack-history-widget { display: none; align-items: center; gap: 8px; background: var(--bg_elevated_primary); border: 1px solid var(--border); border-radius: 12px; padding: 4px 10px; font-size: 13px; font-weight: bold; color: var(--text_primary); }
        .crack-history-btn { cursor: pointer; color: var(--text_secondary); transition: 0.2s; user-select: none; }
        .crack-history-btn:hover { color: var(--text_brand); transform: scale(1.1); }

        /* 라이트 테마 미세 보정 (Scene Painter 방식 감지 결과를 data-cmw-theme로 반영) */
        [data-cmw-theme="light"] .crack-history-widget { background: #ffffff; border-color: #e2e2e8; color: #444; }
        [data-cmw-theme="light"] .crack-pure-magic { box-shadow: 0 3px 8px rgba(106,61,232,.28); }
        [data-cmw-theme="light"] .crack-pure-trans { box-shadow: 0 3px 8px rgba(46,134,222,.28); }

        #crack-ai-panel { position: fixed; top: 80px; right: 30px; z-index: 999999; width: min(440px, 92vw); max-height: 85vh; background-color: var(--bg_screen); border: 1px solid var(--border); border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); color: var(--text_primary); font-family: var(--font-sans); display: none; flex-direction: column; overflow: hidden; }
        #crack-ai-panel[data-cmw-theme="light"] { box-shadow: 0 10px 30px rgba(0,0,0,0.18); }

        .panel-header { padding: 16px 20px; background-color: var(--bg_elevated_primary); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; cursor: move; user-select: none; -webkit-user-select: none; touch-action: none; }
        .panel-title { font-size: 16px; font-weight: 800; color: var(--text_brand); display: flex; align-items: center; gap: 6px; }
        .panel-close { cursor: pointer; font-size: 18px; color: var(--text_secondary); transition: 0.2s; padding: 0 5px; }
        .panel-close:hover { color: #ff4444; transform: scale(1.1); }

        .panel-content { padding: 16px 18px; overflow-y: auto; flex: 1; }
        .panel-content::-webkit-scrollbar { width: 6px; }
        .panel-content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 10px; }

        .setting-group { display: flex; flex-direction: column; gap: 8px; }
        .setting-label { font-size: 12px; color: var(--text_secondary); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;}

        .info-box { background: var(--bg_elevated_primary); border: 1px solid var(--border); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
        .info-title { font-size: 12px; color: var(--text_action_blue_primary); font-weight: 800; display: flex; align-items: center; gap: 4px; }
        .info-text { font-size: 13px; color: var(--text_primary); line-height: 1.5; word-break: break-all; white-space: pre-wrap; }

        .expand-input { width: 100%; box-sizing: border-box; padding: 12px; background-color: var(--bg_elevated_secondary); color: var(--text_primary); border: 1px solid var(--border); border-radius: 8px; font-size: 14px; outline: none; transition: 0.2s; }
        .expand-input:focus { border-color: var(--text_brand); }
        textarea.expand-input { resize: vertical; line-height: 1.5; }


        .tone-container { display: flex; flex-wrap: wrap; gap: 8px; }
        .tone-chip { padding: 6px 14px; border: 1px solid var(--border); border-radius: 20px; font-size: 13px; cursor: pointer; color: var(--text_secondary); background: var(--bg_elevated_primary); transition: 0.2s; }
        .tone-chip:hover { border-color: var(--text_secondary); }
        @media (max-width: 768px) {
            .tone-chip { padding: 5px 10px; font-size: 12px; }
            .tone-container { gap: 6px; }
        }
        .tone-detail-box { background: var(--bg_elevated_secondary); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; font-size: 12px; line-height: 1.55; color: var(--text_secondary); min-height: 40px; white-space: pre-wrap; }
        .tone-detail-box.empty { color: var(--text_secondary); opacity: 0.6; font-style: italic; }
        .tone-chip.active { background-color: #6A3DE8; color: #fff !important; border-color: #6A3DE8 !important; font-weight: bold; }

        .cmw-style-example-pop { position: fixed; z-index: 1000000; max-width: min(360px, calc(100vw - 28px)); padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg_elevated_primary); color: var(--text_primary); box-shadow: 0 10px 28px rgba(0,0,0,0.35); font-size: 12.5px; line-height: 1.55; white-space: pre-wrap; pointer-events: none; opacity: 0; transform: translateY(4px); transition: opacity 0.12s ease, transform 0.12s ease; }
        .cmw-style-example-pop.show { opacity: 1; transform: translateY(0); }
        /* 분위기 그룹별 색 (선택 전 평소 상태) */
        .tone-group-label { font-size: 11px; font-weight: 800; color: var(--text_secondary); letter-spacing: 0.5px; margin: 10px 0 2px; opacity: 0.85; }
        .tone-group-label:first-child { margin-top: 0; }
        .tone-chip[data-group="emo"]   { border-color: #E8628F; color: #E8628F; }
        .tone-chip[data-group="genre"] { border-color: #4F9BE8; color: #4F9BE8; }
        .tone-chip[data-group="dir"]   { border-color: #A06AE8; color: #A06AE8; }
        .tone-chip[data-group="emo"]:hover   { background: rgba(232,98,143,0.12); }
        .tone-chip[data-group="genre"]:hover { background: rgba(79,155,232,0.12); }
        .tone-chip[data-group="dir"]:hover   { background: rgba(160,106,232,0.12); }
        /* 선택되면 그룹 색 무시하고 보라색으로 통일 */

        .acc-wrapper { display: flex; flex-direction: column; gap: 0; }
        .acc-header { font-size: 14px; font-weight: 800; color: var(--text_primary); background: var(--bg_elevated_primary); padding: 14px; border-radius: 8px; cursor: pointer; border: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; transition: 0.2s; }
        .acc-header:hover { background: var(--bg_elevated_secondary); }
        .acc-content { display: none; padding: 16px; border: 1px solid var(--border); border-top: none; border-bottom-left-radius: 8px; border-bottom-right-radius: 8px; background: var(--bg_elevated_primary); flex-direction: column; gap: 16px; }
        .acc-content.open { display: flex; }

        .slots-container { display: flex; flex-direction: column; gap: 8px; }
        .lore-details { border-bottom: 1px solid var(--border); padding-bottom: 12px; }
        .lore-details:last-child { border-bottom: none; padding-bottom: 0; }
        .lore-summary { font-size: 13px; font-weight: 700; color: var(--text_primary); cursor: pointer; display: flex; align-items: center; gap: 8px; margin-bottom: 4px; list-style: none; }
        .lore-summary::-webkit-details-marker { display: none; }
        .lore-summary::before { content: '▶'; font-size: 10px; color: var(--text_secondary); transition: 0.2s; }
        .lore-details[open] .lore-summary::before { transform: rotate(90deg); }
        .lore-summary label { cursor: pointer; display: flex; align-items: center; gap: 6px; margin: 0; }

        .ego-desc { font-size: 11px; text-align: center; color: var(--text_brand); font-weight: bold; }

        .btn-save { width: 100%; background: var(--surface_brand_primary); color: white; border: none; padding: 14px; border-radius: 10px; cursor: pointer; font-weight: 800; font-size: 15px; transition: 0.2s; letter-spacing: 1px; }
        .btn-save:hover { opacity: 0.9; transform: translateY(-2px); }



        /* 탭바 (5탭) */
        .cmw-tabs { display:flex; background: var(--bg_screen); border-bottom:1px solid var(--border); padding:0 6px; flex-shrink:0; }
        .cmw-tab { flex:1; background:none; border:none; border-bottom:2px solid transparent; color:var(--text_secondary); padding:11px 0; font-size:12px; cursor:pointer; transition:0.15s; font-family:inherit; white-space:nowrap; }
        .cmw-tab:hover { color:var(--text_primary); }
        .cmw-tab.active { border-bottom-color: var(--text_brand); color: var(--text_brand); font-weight:700; }
        @media (max-width: 480px) {
            .cmw-tab { font-size: 11px; padding: 10px 0; }
        }
        /* 탭 패널 */
        .cmw-pane { display:none; flex-direction:column; gap:18px; }
        .cmw-pane.active { display:flex; }
        /* 눈금 버튼 */
        .seg-group { display:flex; gap:5px; }
        .seg-btn { flex:1; background:var(--bg_elevated_secondary); color:var(--text_secondary); border:1px solid var(--border); border-radius:6px; padding:9px 0; font-size:13px; cursor:pointer; transition:0.15s; font-family:inherit; }
        .seg-btn:hover { border-color:var(--text_secondary); }
        .seg-btn.active { background:#6A3DE8; color:#fff; border-color:#6A3DE8; font-weight:bold; }
        /* 라디오를 칩으로 */
        .choice-group { display:flex; gap:6px; }
        .choice-group label { flex:1; background:var(--bg_elevated_secondary); color:var(--text_secondary); border:1px solid var(--border); border-radius:6px; padding:8px 0; text-align:center; font-size:12.5px; cursor:pointer; transition:0.15s; margin:0; justify-content:center; display:flex; align-items:center; }
        .choice-group label:has(input:checked) { background:#6A3DE8; color:#fff; border-color:#6A3DE8; font-weight:bold; }
        .choice-group label:has(input:disabled) { opacity:0.45; cursor:not-allowed; }
        .choice-group input { display:none; }
        /* 번역 모드 칩만 파란 계열로 구분 */
        #pane-trans .choice-group label:has(input:checked) { background:#2E86DE; border-color:#2E86DE; }
        /* 저장 버튼 고정 푸터 */
        .panel-footer { padding:12px 18px 16px; border-top:1px solid var(--border); flex-shrink:0; }

        /* 사이드바 행 (Scene Painter '배경 이미지 보기'와 같은 결) */
        #cmw-writer-settings-row > [role="button"]:hover { opacity: .82; }

        @keyframes crack-spin { 100% { transform: rotate(360deg); } }
        .spin-anim { display: inline-block; animation: crack-spin 1s linear infinite; }
    `);

  // =============================================
  // 2. 패널 구성
  // =============================================
  let loreSlotsHTML = "";
  for (let i = 1; i <= 10; i++) {
    loreSlotsHTML += `
            <details class="lore-details">
                <summary class="lore-summary">
                    <label onclick="event.stopPropagation()"><input type="checkbox" id="lore-active-${i}"> 세계관 규칙 ${i}</label>
                </summary>
                <textarea id="lore-text-${i}" class="expand-input" rows="2" placeholder="이 규칙은 AI가 절대적으로 따릅니다..." style="margin-top: 8px;"></textarea>
            </details>
        `;
  }

  const transLangOptionsHTML = TRANS_LANGUAGES
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");

  const panel = document.createElement("div");
  panel.id = "crack-ai-panel";
  panel.innerHTML = `
        <div class="panel-header" id="panel-drag-handle">
            <div class="panel-title">✍️ AI 집필 설정 (V4.0)</div>
            <div class="panel-close" id="close-panel">✕</div>
        </div>

        <div class="cmw-tabs">
            <button class="cmw-tab active" data-pane="pane-write">✍️ 집필</button>
            <button class="cmw-tab" data-pane="pane-trans">🌐 번역</button>
            <button class="cmw-tab" data-pane="pane-mood">🎨 분위기</button>
            <button class="cmw-tab" data-pane="pane-lore">📓 설정집</button>
            <button class="cmw-tab" data-pane="pane-adv">⚙️ 고급</button>
        </div>

        <div class="panel-content">

            <div class="cmw-pane active" id="pane-write">
                <div class="setting-group">
                    <span class="setting-label" style="color: var(--text_brand);">✏️ 다듬기 강도 (내 입력을 얼마나 바꿀지)</span>
                    <div class="seg-group" data-for="cfg-rewrite">
                        <button type="button" class="seg-btn" data-v="1">1</button>
                        <button type="button" class="seg-btn" data-v="2">2</button>
                        <button type="button" class="seg-btn" data-v="3">3</button>
                        <button type="button" class="seg-btn" data-v="4">4</button>
                        <button type="button" class="seg-btn" data-v="5">5</button>
                    </div>
                    <input type="range" id="cfg-rewrite" min="1" max="5" value="2" style="display:none;">
                    <div id="rewrite-desc" class="ego-desc">2단계: 의미 유지 + 말투만 다듬기</div>
                </div>

                <div class="setting-group">
                    <span class="setting-label">🔥 능동성 (PC가 얼마나 치고 나갈지)</span>
                    <div class="seg-group" data-for="cfg-active">
                        <button type="button" class="seg-btn" data-v="1">1</button>
                        <button type="button" class="seg-btn" data-v="2">2</button>
                        <button type="button" class="seg-btn" data-v="3">3</button>
                        <button type="button" class="seg-btn" data-v="4">4</button>
                        <button type="button" class="seg-btn" data-v="5">5</button>
                    </div>
                    <input type="range" id="cfg-active" min="1" max="5" value="2" style="display:none;">
                    <div id="active-desc" class="ego-desc">2단계: 흐름에 호응만</div>
                    <div style="font-size:11px; color:var(--text_secondary); line-height:1.4;">
                        💡 '다듬기 강도'는 입력칸에 글이 있을 때만, '능동성'은 항상 작동해요.
                    </div>
                </div>

                <div class="setting-group">
                    <span class="setting-label">출력 분량 (<span id="len-val" style="color:var(--text_brand);">길게 (1문단, 약 450자)</span>)</span>
                    <div class="seg-group" data-for="cfg-len">
                        <button type="button" class="seg-btn" data-v="1">1</button>
                        <button type="button" class="seg-btn" data-v="2">2</button>
                        <button type="button" class="seg-btn" data-v="3">3</button>
                        <button type="button" class="seg-btn" data-v="4">4</button>
                        <button type="button" class="seg-btn" data-v="5">5</button>
                    </div>
                    <input type="range" id="cfg-len" min="1" max="5" value="3" style="display:none;">
                </div>

                <div class="setting-group">
                    <span class="setting-label">서술 시점</span>
                    <div class="choice-group">
                        <label><input type="radio" name="cfg-pov" value="1" checked> 1인칭 (나)</label>
                        <label><input type="radio" name="cfg-pov" value="3"> 3인칭</label>
                    </div>
                    <input type="text" id="cfg-pov-name" class="expand-input" placeholder="이름 (예: )" style="display:none; margin-top:8px;">
                </div>

                <div class="setting-group">
                    <span class="setting-label" id="cfg-style-label">🖋️ 문체</span>
                    <select id="cfg-style" class="expand-input">
                        <option value="기본">기본</option>
                        <option value="회고체">회고체</option>
                        <option value="유보체">유보체</option>
                        <option value="위트비유체">위트비유체</option>
                    </select>
                </div>
            </div>

            <div class="cmw-pane" id="pane-trans">
                <div class="setting-group">
                    <span class="setting-label" style="color: #2E86DE;">🌐 번역 버튼 동작</span>
                    <div class="choice-group">
                        <label><input type="radio" name="cfg-trans-mode" value="only" checked> 번역만</label>
                        <label><input type="radio" name="cfg-trans-mode" value="write"> 집필 후 번역</label>
                    </div>
                    <div id="trans-mode-desc" class="ego-desc" style="color:#2E86DE;">입력한 문장을 그대로 목표 언어로 번역해요.</div>
                    <div style="font-size:11px; color:var(--text_secondary); line-height:1.45;">
                        💡 이 탭의 설정은 바꾸는 즉시 저장돼요. API·모델은 고급 탭 설정을 그대로 사용해요.
                    </div>
                </div>

                <div class="setting-group">
                    <span class="setting-label">목표 언어</span>
                    <select id="cfg-trans-lang" class="expand-input">${transLangOptionsHTML}</select>
                    <input type="text" id="cfg-trans-custom-lang" class="expand-input" placeholder="예: Polish, Swahili, 고전 라틴어..." style="display:none;">
                </div>

                <div class="setting-group">
                    <span class="setting-label">출력 형식</span>
                    <textarea id="cfg-trans-format" class="expand-input" rows="2" placeholder="{번역문} ({원문})"></textarea>
                    <div style="font-size:11px; color:var(--text_secondary); line-height:1.55;">
                        <b>{번역문}</b> 자리에 번역된 대사, <b>{원문}</b> 자리에 한국어 원문이 들어가요.<br>
                        예: <b>{번역문} ({원문})</b> · <b>{원문} → {번역문}</b> · <b>{번역문}</b> (원문 생략)<br>
                        <b>*서술*</b> 부분은 항상 한국어 그대로 유지돼요.
                    </div>
                </div>

                <div class="setting-group">
                    <span class="setting-label">🗣️ 말투/캐릭터 메모 (방별 실시간 저장)</span>
                    <textarea id="cfg-trans-note" class="expand-input" rows="3" placeholder="예: 30대 보스턴 형사, 짧고 건조한 슬랭, 반말"></textarea>
                    <div style="font-size:11px; color:var(--text_secondary); line-height:1.4;">
                        적어두면 번역된 대사에 이 말투가 반영돼요. 비워두면 일반 번역.
                    </div>
                </div>
            </div>

            <div class="cmw-pane" id="pane-mood">
                <div class="setting-group">
                    <span class="setting-label">분위기 추가 (중복 선택 가능)</span>
                    <div class="tone-group-label">🩷 감정·정서</div>
                    <div class="tone-container">
                        <span class="tone-chip" data-group="emo" data-val="로맨스">💕 로맨스</span>
                        <span class="tone-chip" data-group="emo" data-val="코믹">😂 코믹</span>
                        <span class="tone-chip" data-group="emo" data-val="피폐">🌑 피폐</span>
                        <span class="tone-chip" data-group="emo" data-val="애절함">💧 애절/슬픔</span>
                        <span class="tone-chip" data-group="emo" data-val="힐링">🌸 힐링</span>
                        <span class="tone-chip" data-group="emo" data-val="일상">☕ 일상</span>
                    </div>
                    <div class="tone-group-label">💙 장르·공기</div>
                    <div class="tone-container">
                        <span class="tone-chip" data-group="genre" data-val="액션">⚔️ 액션</span>
                        <span class="tone-chip" data-group="genre" data-val="스릴러">🔪 스릴러</span>
                        <span class="tone-chip" data-group="genre" data-val="서스펜스">😶‍🌫️ 서스펜스</span>
                        <span class="tone-chip" data-group="genre" data-val="공포">👻 공포</span>
                        <span class="tone-chip" data-group="genre" data-val="블랙코미디">🃏 블랙코미디</span>
                        <span class="tone-chip" data-group="genre" data-val="사극">🏛️ 사극</span>
                        <span class="tone-chip" data-group="genre" data-val="무협">🗡️ 무협</span>
                    </div>
                    <div class="tone-group-label">💜 연출·수위</div>
                    <div class="tone-container">
                        <span class="tone-chip" data-group="dir" data-val="관능적">💋 관능적</span>
                        <span class="tone-chip" data-group="dir" data-val="몽환적">✨ 몽환적</span>
                        <span class="tone-chip" data-group="dir" data-val="신음">🔞 신음</span>
                    </div>
                </div>
                <div class="setting-group">
                    <span class="setting-label">🎬 선택한 분위기 연출 방향</span>
                    <div id="tone-detail-box" class="tone-detail-box empty">분위기를 선택하면 각 연출 방향이 여기에 모여요.</div>
                </div>
                <div class="setting-group" style="background: var(--bg_elevated_primary); padding: 12px; border-radius: 8px; border: 1px solid var(--border);">
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:14px; font-weight:800; color:var(--text_primary);">
                        <input type="checkbox" id="cfg-markdown-mode">
                        🧩 Crack Markdown 렌더 규칙 반영
                    </label>
                    <div style="font-size:11px; color:var(--text_secondary); line-height:1.45;">
                        켜면 Crack에서 실제 렌더되는 Markdown 문법만 기준으로 답변을 다듬습니다. 방별 필수 양식은 커스텀 규칙/필수 적용에 따로 넣어주세요.
                    </div>
                </div>
            </div>

            <div class="cmw-pane" id="pane-lore">
                <div class="info-box">
                    <div>
                        <div class="info-title">🔍 현재 감지된 프로필 (채팅방 자동저장)</div>
                        <div id="detected-profile" class="info-text" style="font-weight:800; margin-top:6px;">스캔 대기 중...</div>
                    </div>
                    <div style="border-top: 1px solid var(--border); padding-top: 10px;">
                        <div class="info-title">📝 PC 추가 설정 (방별 실시간 저장)</div>
                        <textarea id="cfg-pc-note" class="expand-input" style="font-size:13px; height:80px; margin-top:6px; margin-bottom:0;" placeholder="AI 집필에 반영할 PC(플레이어)의 성격, 과거사, 특이사항 등을 적어주세요."></textarea>
                    </div>
                </div>
                <div class="setting-group">
                    <span class="setting-label">💡 커스텀 규칙 (방별 실시간 저장)</span>
                    <textarea id="cfg-custom-rule" class="expand-input" rows="4" placeholder="예: 필담은 \` \`로 묶어서 표현할 것."></textarea>
                </div>
                <div class="acc-wrapper">
                    <div class="acc-header" data-target="acc-lore">🌍 세계관 사전 (최대 10개) <span>▼</span></div>
                    <div id="acc-lore" class="acc-content">
                        <div class="slots-container">${loreSlotsHTML}</div>
                    </div>
                </div>
            </div>

            <div class="cmw-pane" id="pane-adv">
                <div class="setting-group">
                    <span class="setting-label" style="margin-top:0;">API 제공자</span>
                    <select id="cfg-api-provider" class="expand-input">
                        <option value="google">Google (기본 API)</option>
                        <option value="firebase">Firebase (Vertex API)</option>
                        <option value="deepseek">DeepSeek API</option>
                    </select>
                </div>
                <div class="setting-group">
                    <span class="setting-label" id="cfg-key-label">GEMINI API KEY</span>
                    <input type="password" id="cfg-api-key" class="expand-input" placeholder="키를 입력하세요">
                    <textarea id="cfg-firebase-script" class="expand-input" rows="5" placeholder="파이어베이스에서 복사한 코드 전체를 여기에 그대로 붙여넣어 주세요!" style="display:none; font-family: monospace; font-size:12px;"></textarea>
                </div>
                <div class="setting-group">
                    <span class="setting-label">AI 모델 선택</span>
                    <select id="cfg-model" class="expand-input">
                        <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                        <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview</option>
                        <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                        <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    </select>
                </div>
                <div class="setting-group" style="background: var(--bg_elevated_primary); padding: 12px; border-radius: 8px; border: 1px solid var(--border);">
                    <div id="thinking-ui-container"></div>
                    <div id="cost-display-container" style="display:none; margin-top: 8px; padding: 10px; background: var(--bg_elevated_secondary); border-radius: 6px; font-size: 12px; line-height: 1.4;"></div>
                </div>
                <div class="setting-group">
                    <span class="setting-label">🧠 AI 대화 기억력 (현재 <span id="mem-val" style="color:var(--text_brand);">8</span>개)</span>
                    <input type="range" id="cfg-memory" min="1" max="20" value="8" style="width:100%;">
                </div>
            </div>

        </div>

        <div class="panel-footer">
            <button id="cfg-save-btn" class="btn-save">글로벌 설정 저장</button>
        </div>
    `;
  document.body.appendChild(panel);

  const styleExamplePop = document.createElement("div");
  styleExamplePop.id = "cmw-style-example-pop";
  styleExamplePop.className = "cmw-style-example-pop";
  document.body.appendChild(styleExamplePop);

  // =============================================
  // 2-0. 테마 감지 (Scene Painter / 번역기와 같은 밝기 프로브 방식)
  //      Crack 다크/라이트 전환 및 Scene Painter 스킨과 시각적으로 맞춘다.
  // =============================================
  function isDarkThemeCmw() {
    const html = document.documentElement;
    const body = document.body;
    const hints = [
      html.getAttribute("data-theme"), html.getAttribute("data-color-mode"), html.className,
      body?.getAttribute("data-theme"), body?.getAttribute("data-color-mode"), body?.className,
    ].join(" ").toLowerCase();

    if (/\bdark\b|theme-dark|dark-mode|darkmode|color-scheme-dark/.test(hints)) return true;
    if (/\blight\b|theme-light|light-mode|lightmode|color-scheme-light/.test(hints)) return false;

    // 텍스트 색 밝기로 판별 (Scene Painter와 같은 방식: 글자가 밝으면 다크모드)
    try {
      const probe = document.createElement("span");
      probe.style.cssText = "position:fixed;left:-9999px;color:var(--text_primary, var(--foreground, inherit));";
      document.documentElement.appendChild(probe);
      const rgb = getComputedStyle(probe).color.match(/\d+/g);
      probe.remove();
      if (rgb && rgb.length >= 3) {
        const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
        if (lum > 0.58) return true;
        if (lum < 0.42) return false;
      }
    } catch (e) {}

    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches || false;
  }

  let lastCmwThemeCheckAt = 0;
  function applyCmwTheme(force = false) {
    const now = Date.now();
    if (!force && now - lastCmwThemeCheckAt < 3000) return;
    lastCmwThemeCheckAt = now;

    const theme = isDarkThemeCmw() ? "dark" : "light";
    panel.setAttribute("data-cmw-theme", theme);
    document.getElementById("crack-pure-send-left-group")?.setAttribute("data-cmw-theme", theme);
    document.getElementById("crack-pure-settings-btn")?.setAttribute("data-cmw-theme", theme);
    document.getElementById("cmw-writer-settings-row")?.setAttribute("data-cmw-theme", theme);
  }

  function togglePanelVisibility() {
    updateContextDisplay();
    panel.style.display = panel.style.display === "flex" ? "none" : "flex";
    if (panel.style.display === "flex") applyCmwTheme(true);
  }

  // =============================================
  // 2-1. API 제공자 / 모델 / 추론 UI
  // =============================================
  function syncModelOptions(provider, preferredModel = "") {
    const select = document.getElementById("cfg-model");
    if (!select) return "";

    const options = PROVIDER_MODEL_OPTIONS[provider] || PROVIDER_MODEL_OPTIONS.google;
    const current = preferredModel || select.value;
    select.innerHTML = options
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join("");

    const valid = options.some(([value]) => value === current);
    select.value = valid ? current : options[0][0];
    return select.value;
  }

  function updateThinkingUI() {
    const provider = document.getElementById("cfg-api-provider")?.value || "google";
    const currentModel = document.getElementById("cfg-model").value;
    const container = document.getElementById("thinking-ui-container");
    if (!container) return;

    if (provider === "deepseek" || currentModel.startsWith("deepseek-")) {
      const saved = GM_getValue("thinkDeepSeek_" + currentModel, "on");
      container.innerHTML = `
              <span class="setting-label" style="color: var(--text_action_blue_primary);">🧠 DeepSeek Thinking</span>
              <select id="cfg-think-val" class="expand-input" style="margin-top: 6px;">
                  <option value="on" ${saved !== "off" ? "selected" : ""}>On</option>
                  <option value="off" ${saved === "off" ? "selected" : ""}>Off</option>
              </select>
              <div style="font-size:10px; color:var(--text_secondary); margin-top:4px;">DeepSeek V4는 Thinking/Non-thinking 전환을 지원합니다.</div>
          `;
      return;
    }

    const savedLevel = GM_getValue("thinkLevel_" + currentModel, "medium");
    let savedBudget = parseInt(GM_getValue("thinkBudget_" + currentModel, 1024));
    if (isNaN(savedBudget) || savedBudget < 128) savedBudget = 1024;

    if (currentModel.includes("gemini-3")) {
      container.innerHTML = `
              <span class="setting-label" style="color: var(--text_action_blue_primary);">🧠 추론 강도 (Thinking Level)</span>
              <select id="cfg-think-val" class="expand-input" style="margin-top: 6px;">
                  <option value="minimal" ${savedLevel === "minimal" ? "selected" : ""}>Minimal</option>
                  <option value="low" ${savedLevel === "low" ? "selected" : ""}>Low</option>
                  <option value="medium" ${savedLevel === "medium" ? "selected" : ""}>Medium</option>
                  <option value="high" ${savedLevel === "high" ? "selected" : ""}>High</option>
              </select>
          `;
    } else {
      container.innerHTML = `
              <span class="setting-label" style="color: var(--text_action_blue_primary);">🧠 추론 예산 (Thinking Budget - 최소 128)</span>
              <input type="number" id="cfg-think-val" class="expand-input" value="${savedBudget}" min="128" step="128" style="margin-top: 6px; padding: 8px;">
          `;
    }
  }

  document.getElementById("cfg-model").addEventListener("change", updateThinkingUI);

  function updateCostUI(usage, modelId) {
    if (!usage) return;
    const costData = calculateCost(usage, modelId);
    if (costData) {
      const { read, input, output, thoughts } = costData.tokens;
      const container = document.getElementById("cost-display-container");
      container.style.display = "block";
      container.innerHTML = `
              <div style="color: var(--text_brand); font-weight: 800; font-size: 13px; margin-bottom: 4px;">💸 예상 생성 요금: ${formatUsd(costData.usd)}</div>
              <div style="color: var(--text_secondary);">
                  📚 캐시읽기: ${read} | 📝 일반입력: ${input}<br>
                  💬 일반출력: ${output} | 🤔 추론출력: ${thoughts}
              </div>
          `;
    }
  }

  // =============================================
  // 3. 패널 드래그 관리
  //    - PC: 마우스 드래그
  //    - 모바일: 터치/펜 드래그
  // =============================================
  const dragHandle = document.getElementById("panel-drag-handle");
  let pendingDrag = false,
    isDragging = false,
    startX = 0,
    startY = 0,
    initLeft = 0,
    initTop = 0,
    activeDragId = null;

  function clampPanelPosition(left, top) {
    const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);

    return {
      left: Math.max(0, Math.min(left, maxLeft)),
      top: Math.max(0, Math.min(top, maxTop)),
    };
  }

  function applyPanelPosition(left, top, save = false) {
    const pos = clampPanelPosition(left, top);
    panel.style.left = pos.left + "px";
    panel.style.top = pos.top + "px";
    panel.style.right = "auto";

    if (save) {
      GM_setValue("panelLeft", Math.round(pos.left));
      GM_setValue("panelTop", Math.round(pos.top));
    }
  }

  function getDragPoint(e) {
    const touch = e.touches?.[0] || e.changedTouches?.[0];
    return {
      x: touch ? touch.clientX : e.clientX,
      y: touch ? touch.clientY : e.clientY,
    };
  }

  let savedLeft = GM_getValue("panelLeft", null);
  let savedTop = GM_getValue("panelTop", null);
  if (savedLeft !== null && savedTop !== null) {
    savedLeft = Number(savedLeft);
    savedTop = Number(savedTop);

    if (
      isNaN(savedLeft) ||
      isNaN(savedTop) ||
      savedLeft < 0 ||
      savedTop < 0 ||
      savedLeft > window.innerWidth ||
      savedTop > window.innerHeight
    ) {
      GM_deleteValue("panelLeft");
      GM_deleteValue("panelTop");
    } else {
      applyPanelPosition(savedLeft, savedTop, false);
    }
  }

  function startPanelDrag(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.pointerType && e.isPrimary === false) return;

    pendingDrag = true;
    isDragging = false;
    activeDragId = e.pointerId ?? null;

    const point = getDragPoint(e);
    startX = point.x;
    startY = point.y;

    const rect = panel.getBoundingClientRect();
    initLeft = rect.left;
    initTop = rect.top;

    try {
      if (e.pointerId !== undefined) dragHandle.setPointerCapture(e.pointerId);
    } catch (err) {}
  }

  function movePanelDrag(e) {
    if (!pendingDrag) return;
    if (activeDragId !== null && e.pointerId !== undefined && e.pointerId !== activeDragId) return;

    const point = getDragPoint(e);
    const dx = point.x - startX;
    const dy = point.y - startY;

    if (!isDragging) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      isDragging = true;
    }

    e.preventDefault();
    applyPanelPosition(initLeft + dx, initTop + dy, false);
  }

  function endPanelDrag(e) {
    if (!pendingDrag) return;
    if (activeDragId !== null && e?.pointerId !== undefined && e.pointerId !== activeDragId) return;

    pendingDrag = false;
    activeDragId = null;

    if (isDragging) {
      isDragging = false;
      GM_setValue("panelLeft", parseInt(panel.style.left, 10) || 0);
      GM_setValue("panelTop", parseInt(panel.style.top, 10) || 0);
    }
  }

  if (window.PointerEvent) {
    dragHandle.addEventListener("pointerdown", startPanelDrag);
    document.addEventListener("pointermove", movePanelDrag, { passive: false });
    document.addEventListener("pointerup", endPanelDrag);
    document.addEventListener("pointercancel", endPanelDrag);
  } else {
    dragHandle.addEventListener("mousedown", startPanelDrag);
    document.addEventListener("mousemove", movePanelDrag);
    document.addEventListener("mouseup", endPanelDrag);

    dragHandle.addEventListener("touchstart", startPanelDrag, { passive: false });
    document.addEventListener("touchmove", movePanelDrag, { passive: false });
    document.addEventListener("touchend", endPanelDrag);
    document.addEventListener("touchcancel", endPanelDrag);
  }

  window.addEventListener("resize", () => {
    const rect = panel.getBoundingClientRect();
    applyPanelPosition(rect.left, rect.top, panel.style.display !== "none");
  });

  // =============================================
  // 4. 프로필 스캐너
  //    - 1순위: 어시스턴트 확프 방식(API에서 현재 방 chatProfile._id를 읽고 프로필 목록에서 매칭)
  //    - 2순위: 기존 방식(DOM의 "현재" 뱃지 스캔)
  // =============================================
  let profileScanInFlight = null;
  let lastProfileApiScanRoom = "";
  let lastProfileApiScanAt = 0;

  function getCrackAccessToken() {
    try {
      return document.cookie
        .split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith("access_token="))
        ?.slice(13) || "";
    } catch (e) {
      return "";
    }
  }

  async function fetchCrackJson(url) {
    const token = getCrackAccessToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(url, {
      credentials: "include",
      headers,
    });
    if (!res.ok) throw new Error(`Crack API HTTP ${res.status}`);
    return await res.json();
  }

  function pickProfileList(json) {
    const data = json?.data ?? json;
    if (Array.isArray(data?.chatProfiles)) return data.chatProfiles;
    if (Array.isArray(data?.profiles)) return data.profiles;
    if (Array.isArray(data)) return data;
    return [];
  }

  function normalizeChatProfile(profile) {
    if (!profile || typeof profile !== "object") return null;
    const name = String(profile.name || profile.profileName || profile.title || "").trim();
    const info = String(
      profile.information ||
      profile.description ||
      profile.prompt ||
      profile.content ||
      profile.persona ||
      "",
    ).trim();
    if (!name && !info) return null;
    return { name, profile: info };
  }

  function saveScannedProfile(room, data, source = "api") {
    if (!room || !data) return null;
    const name = String(data.name || "").trim();
    const prof = String(data.profile || "").trim();
    if (!name && !prof) return null;
    GM_setValue("scannedCharName_" + room, name);
    GM_setValue("scannedCharProfile_" + room, prof);
    GM_setValue("scannedCharProfileSource_" + room, source);
    return { name, profile: prof, source };
  }

  function readStoredProfile(room = getChatRoomId()) {
    const name = GM_getValue("scannedCharName_" + room, "");
    const prof = GM_getValue("scannedCharProfile_" + room, "");
    const source = GM_getValue("scannedCharProfileSource_" + room, "");
    return name || prof ? { name, profile: prof, source } : null;
  }

  async function refreshCurrentProfileFromApi(force = false) {
    const room = getChatRoomId();
    if (!room || room === "global_room") return null;

    const now = Date.now();
    if (!force && lastProfileApiScanRoom === room && now - lastProfileApiScanAt < 12000) {
      return readStoredProfile(room);
    }
    if (profileScanInFlight) return profileScanInFlight;

    lastProfileApiScanRoom = room;
    lastProfileApiScanAt = now;

    profileScanInFlight = (async () => {
      const chatJson = await fetchCrackJson(`${API_BASE}/v3/chats/${room}`);
      const roomData = chatJson?.data ?? chatJson;
      const wantId = roomData?.chatProfile?._id || roomData?.chatProfile?.id || "";

      // 방 데이터에 chatProfile 본문이 같이 내려오는 경우에는 일단 후보로 잡아둔다.
      let picked = normalizeChatProfile(roomData?.chatProfile);

      // 어시스턴트 확프와 같은 핵심 로직:
      // 현재 사용자 profile id를 얻고 → /chat-profiles 목록에서 현재 방 chatProfile._id와 같은 항목을 우선 선택.
      try {
        const profileJson = await fetchCrackJson(`${API_ORIGIN}/crack-api/profiles`);
        const profileId = profileJson?.data?._id || profileJson?.data?.id || "";
        if (profileId) {
          const listJson = await fetchCrackJson(`${API_ORIGIN}/crack-api/profiles/${profileId}/chat-profiles`);
          const list = pickProfileList(listJson);
          let p = null;
          if (wantId) p = list.find((item) => item && (item._id === wantId || item.id === wantId));
          if (!p) p = list.find((item) => item && item.isRepresentative);
          if (!p) p = list[0] || null;
          picked = normalizeChatProfile(p) || picked;
        }
      } catch (e) {
        // 프로필 목록 API가 잠깐 실패하면 방 데이터에 포함된 chatProfile 또는 기존 저장값을 사용한다.
      }

      return saveScannedProfile(room, picked, "api") || readStoredProfile(room);
    })().finally(() => {
      profileScanInFlight = null;
    });

    return profileScanInFlight;
  }

  function scanProfileFromDomFallback() {
    const room = getChatRoomId();
    const currentBadge = Array.from(document.querySelectorAll("p")).find(
      (p) => p.textContent.trim() === "현재",
    );
    if (!currentBadge) return null;

    const container =
      currentBadge.closest('div[cursor="pointer"]') ||
      currentBadge.parentElement?.parentElement?.parentElement;
    if (!container) return null;

    const nameEl = container.querySelector('p[color="text_primary"]');
    const profileEl = container.querySelector('p[color="text_secondary"]');
    return saveScannedProfile(
      room,
      {
        name: nameEl?.textContent?.trim() || "",
        profile: profileEl?.textContent?.trim() || "",
      },
      "dom",
    );
  }

  function backgroundScanner() {
    refreshCurrentProfileFromApi(false)
      .then(() => updateContextDisplay())
      .catch(() => {
        scanProfileFromDomFallback();
        updateContextDisplay();
      });
  }

  function updateContextDisplay() {
    const room = getChatRoomId();
    const data = readStoredProfile(room);
    const box = document.getElementById("detected-profile");
    if (!box) return;

    if (data) {
      const sourceLabel = data.source === "api" ? "API 자동 감지" : "DOM 보조 감지";
      box.innerText = `[${data.name || "이름 없음"}]\n${data.profile || "설정 내용 없음"}\n\n(${sourceLabel})`;
    } else {
      box.innerText = "⏳ 현재 채팅방 프로필을 읽는 중입니다. 잠시 뒤 다시 열어보세요.";
    }
  }

  document.getElementById("cfg-pc-note").addEventListener("input", (e) => {
    const room = getChatRoomId();
    GM_setValue("cfgPcNote_" + room, e.target.value);
  });
  document.getElementById("cfg-custom-rule").addEventListener("input", (e) => {
    const room = getChatRoomId();
    GM_setValue("cfgCustomRule_" + room, e.target.value);
  });

  // =============================================
  // 5. 설정 이벤트 & UI 토글
  // =============================================
  const rewriteSlider = document.getElementById("cfg-rewrite");
  const rewriteDesc = document.getElementById("rewrite-desc");
  const activeSlider = document.getElementById("cfg-active");
  const activeDesc = document.getElementById("active-desc");
  const rewriteTexts = [
    "1단계: 원본 거의 그대로 (맞춤법만)",
    "2단계: 의미 유지 + 말투만 다듬기",
    "3단계: 핵심 보존 + 표현 매끄럽게 윤문",
    "4단계: 의도 살려 적극 확장",
    "5단계: 자유롭게 재구성·재창조",
  ];
  const activeTexts = [
    "1단계: 조용히 관망 (행동 최소)",
    "2단계: 흐름에 호응만",
    "3단계: 상황 안에서 자연스럽게 전개",
    "4단계: PC가 분위기 주도",
    "5단계: 장면을 강하게 장악",
  ];

  function saveVisibleKeyForProvider(provider) {
    const keyInput = document.getElementById("cfg-api-key");
    if (!keyInput || !provider || provider === "firebase") return;
    GM_setValue(getProviderKeyName(provider), keyInput.value.trim());
  }

  function toggleProviderUI(preferredModel = "") {
    const provider = document.getElementById("cfg-api-provider").value;
    const keyInput = document.getElementById("cfg-api-key");
    const prevProvider = keyInput?.dataset.provider || "";
    if (prevProvider && prevProvider !== provider) saveVisibleKeyForProvider(prevProvider);

    if (provider === "firebase") {
      keyInput.style.display = "none";
      document.getElementById("cfg-firebase-script").style.display = "block";
      document.getElementById("cfg-key-label").innerText = "Firebase Config 복붙창:";
    } else {
      keyInput.style.display = "block";
      document.getElementById("cfg-firebase-script").style.display = "none";
      document.getElementById("cfg-key-label").innerText = provider === "deepseek" ? "DEEPSEEK API KEY" : "GEMINI API KEY";
      keyInput.value = GM_getValue(getProviderKeyName(provider), "");
    }

    if (keyInput) keyInput.dataset.provider = provider;
    syncModelOptions(provider, preferredModel || GM_getValue("cfgModel_" + provider, GM_getValue("cfgModel", "")));
    updateThinkingUI();
  }

  document.getElementById("cfg-api-provider").addEventListener("change", () => toggleProviderUI());

  function updateToneDetailBox() {
    const box = document.getElementById("tone-detail-box");
    if (!box) return;
    const actives = Array.from(document.querySelectorAll(".tone-chip.active"))
      .map((c) => c.dataset.val);
    const lines = actives
      .map((v) => (v === "신음" ? MOAN_TONE_INSTRUCTION : TONE_DETAILS[v]))
      .filter(Boolean);
    if (lines.length === 0) {
      box.classList.add("empty");
      box.textContent = "분위기를 선택하면 각 연출 방향이 여기에 모여요.";
    } else {
      box.classList.remove("empty");
      box.textContent = lines.join("\n");
    }
  }


  let styleExampleTouchTimer = null;

  function getSelectedStyleExample() {
    const styleValue = document.getElementById("cfg-style")?.value || "기본";
    return STYLE_EXAMPLES[styleValue] || "";
  }

  function positionStyleExamplePop(anchor) {
    if (!styleExamplePop || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const margin = 10;
    const popRect = styleExamplePop.getBoundingClientRect();
    const width = popRect.width || 320;
    const height = popRect.height || 80;
    let left = Math.min(Math.max(rect.left, margin), window.innerWidth - width - margin);
    let top = rect.bottom + 8;
    if (top + height + margin > window.innerHeight) top = Math.max(margin, rect.top - height - 8);
    styleExamplePop.style.left = left + "px";
    styleExamplePop.style.top = top + "px";
  }

  function showStyleExample(anchor) {
    const text = getSelectedStyleExample();
    if (!text || !styleExamplePop) return;
    styleExamplePop.textContent = text;
    styleExamplePop.classList.add("show");
    requestAnimationFrame(() => positionStyleExamplePop(anchor));
  }

  function hideStyleExample() {
    if (styleExampleTouchTimer) {
      clearTimeout(styleExampleTouchTimer);
      styleExampleTouchTimer = null;
    }
    styleExamplePop?.classList.remove("show");
  }

  function bindStyleExampleTooltip() {
    // 문체 라벨은 설명용 텍스트라 미리보기를 띄우지 않는다.
    // 실제 선택 대상인 드롭박스에만 hover/focus/long-press 미리보기를 연결한다.
    const target = document.getElementById("cfg-style");
    if (!target) return;

    target.addEventListener("mouseenter", () => showStyleExample(target));
    target.addEventListener("mouseleave", hideStyleExample);
    target.addEventListener("focus", () => showStyleExample(target));
    target.addEventListener("blur", hideStyleExample);
    target.addEventListener("touchstart", () => {
      hideStyleExample();
      styleExampleTouchTimer = setTimeout(() => showStyleExample(target), 450);
    }, { passive: true });
    target.addEventListener("touchend", hideStyleExample);
    target.addEventListener("touchcancel", hideStyleExample);

    window.addEventListener("scroll", hideStyleExample, true);
    window.addEventListener("resize", hideStyleExample);
  }


  function syncStylePovLock() {
    const styleValue = document.getElementById("cfg-style")?.value || "기본";
    const isRetroStyle = styleValue === "회고체";
    const pov1 = document.querySelector('input[name="cfg-pov"][value="1"]');
    const pov3 = document.querySelector('input[name="cfg-pov"][value="3"]');
    const povName = document.getElementById("cfg-pov-name");
    const pov3Label = pov3?.closest("label");

    if (pov3) pov3.disabled = isRetroStyle;
    if (pov3Label) pov3Label.title = isRetroStyle ? "회고체는 1인칭 고정" : "";

    if (isRetroStyle) {
      if (pov1) pov1.checked = true;
      GM_setValue("cfgPov", "1");
    }

    if (povName) {
      povName.style.display = !isRetroStyle && pov3?.checked ? "block" : "none";
    }
  }

  // ---------------------------------------------
  // 번역 탭 전용 (전부 실시간 저장)
  // ---------------------------------------------
  function updateTransModeDesc() {
    const desc = document.getElementById("trans-mode-desc");
    if (!desc) return;
    const mode = document.querySelector('input[name="cfg-trans-mode"]:checked')?.value || "only";
    desc.innerText =
      mode === "write"
        ? "✨ 집필로 문장을 다듬어 부풀린 뒤, 이어서 번역해요. (API 2회 호출)"
        : "입력한 문장을 그대로 목표 언어로 번역해요.";
  }

  function toggleTransCustomLangUI() {
    const sel = document.getElementById("cfg-trans-lang");
    const custom = document.getElementById("cfg-trans-custom-lang");
    if (!sel || !custom) return;
    custom.style.display = sel.value === "__custom__" ? "block" : "none";
  }

  function initTransEvents() {
    document.getElementsByName("cfg-trans-mode").forEach((r) => {
      r.addEventListener("change", () => {
        const mode = document.querySelector('input[name="cfg-trans-mode"]:checked')?.value || "only";
        GM_setValue("cfgTransMode", mode);
        updateTransModeDesc();
      });
    });

    const langSel = document.getElementById("cfg-trans-lang");
    langSel?.addEventListener("change", () => {
      GM_setValue("cfgTransLang", langSel.value);
      toggleTransCustomLangUI();
    });

    document.getElementById("cfg-trans-custom-lang")?.addEventListener("input", (e) => {
      GM_setValue("cfgTransCustomLang", e.target.value.trim());
    });

    document.getElementById("cfg-trans-format")?.addEventListener("input", (e) => {
      // {번역문} 누락 등 잘못된 형식은 사용 시점에 기본값으로 자동 보정된다.
      GM_setValue("cfgTransFormat", e.target.value);
    });

    document.getElementById("cfg-trans-note")?.addEventListener("input", (e) => {
      const room = getChatRoomId();
      GM_setValue("transNote_" + room, e.target.value);
    });
  }

  function loadTransCfg(room) {
    const mode = GM_getValue("cfgTransMode", "only");
    const modeRadio = document.querySelector(`input[name="cfg-trans-mode"][value="${mode}"]`)
      || document.querySelector('input[name="cfg-trans-mode"][value="only"]');
    if (modeRadio) modeRadio.checked = true;
    updateTransModeDesc();

    const langSel = document.getElementById("cfg-trans-lang");
    const savedLang = GM_getValue("cfgTransLang", "English");
    if (langSel) {
      if (savedLang && ![...langSel.options].some((o) => o.value === savedLang)) {
        const opt = document.createElement("option");
        opt.value = savedLang;
        opt.textContent = savedLang;
        langSel.insertBefore(opt, langSel.lastElementChild);
      }
      langSel.value = savedLang || "English";
    }

    document.getElementById("cfg-trans-custom-lang").value = GM_getValue("cfgTransCustomLang", "");
    toggleTransCustomLangUI();

    document.getElementById("cfg-trans-format").value = GM_getValue("cfgTransFormat", TRANS_DEFAULT_FORMAT);
    document.getElementById("cfg-trans-note").value = GM_getValue("transNote_" + room, "");
  }

  const loadCfg = () => {
    const room = getChatRoomId();

    const savedProvider = GM_getValue("apiProvider", "google");
    document.getElementById("cfg-api-provider").value = savedProvider;
    document.getElementById("cfg-firebase-script").value = GM_getValue("firebaseScript", "");
    const savedModel = GM_getValue("cfgModel_" + savedProvider, GM_getValue("cfgModel", "gemini-3.1-pro-preview"));
    toggleProviderUI(savedModel);


    document.getElementById("cfg-pc-note").value = GM_getValue(
      "cfgPcNote_" + room,
      "",
    );
    document.getElementById("cfg-custom-rule").value = GM_getValue(
      "cfgCustomRule_" + room,
      "",
    );

    const lenVal = GM_getValue("cfgLen", 3);
    document.getElementById("cfg-len").value = lenVal;
    document.getElementById("cfg-len").dispatchEvent(new Event("input"));

    const savedStyle = GM_getValue("cfgStyle", "기본");
    const styleSelect = document.getElementById("cfg-style");
    if (styleSelect) styleSelect.value = STYLE_DETAILS[savedStyle] !== undefined ? savedStyle : "기본";

    const pov = GM_getValue("cfgPov", "1");
    document.querySelector(`input[name="cfg-pov"][value="${pov}"]`).checked =
      true;
    document.getElementById("cfg-pov-name").value = GM_getValue(
      "cfgPovName",
      "",
    );
    document.getElementById("cfg-pov-name").style.display =
      pov === "3" ? "block" : "none";
    syncStylePovLock();

    rewriteSlider.value = GM_getValue("cfgRewrite", 2);
    rewriteSlider.dispatchEvent(new Event("input"));
    activeSlider.value = GM_getValue("cfgActive", 2);
    activeSlider.dispatchEvent(new Event("input"));

    const savedTones = JSON.parse(GM_getValue("cfgTones", "[]"));
    document.querySelectorAll(".tone-chip").forEach((chip) => {
      chip.classList.toggle("active", savedTones.includes(chip.dataset.val));
    });
    updateToneDetailBox();

    for (let i = 1; i <= 10; i++) {
      document.getElementById(`lore-active-${i}`).checked = GM_getValue(
        getLoreActiveKey(room, i),
        false,
      );
      document.getElementById(`lore-text-${i}`).value = GM_getValue(
        getLoreTextKey(room, i),
        "",
      );
    }

    const mem = GM_getValue("cfgMemory", 8);
    document.getElementById("cfg-memory").value = mem;
    document.getElementById("mem-val").innerText = mem;

    const markdownMode = document.getElementById("cfg-markdown-mode");
    if (markdownMode) markdownMode.checked = GM_getValue("cfgMarkdownMode", false);

    loadTransCfg(room);

    updateContextDisplay();
    refreshCurrentProfileFromApi(true)
      .then(() => updateContextDisplay())
      .catch(() => {
        scanProfileFromDomFallback();
        updateContextDisplay();
      });
    updateThinkingUI();
  };

  const saveCfg = () => {
    const room = getChatRoomId();

    const currentProvider = document.getElementById("cfg-api-provider").value;
    const currentModelValue = document.getElementById("cfg-model").value;
    GM_setValue("apiProvider", currentProvider);
    if (currentProvider !== "firebase") {
      GM_setValue(getProviderKeyName(currentProvider), document.getElementById("cfg-api-key").value.trim());
    }
    GM_setValue("firebaseScript", document.getElementById("cfg-firebase-script").value.trim());
    GM_setValue("cfgModel", currentModelValue);
    GM_setValue("cfgModel_" + currentProvider, currentModelValue);

    GM_setValue(
      "cfgPcNote_" + room,
      document.getElementById("cfg-pc-note").value.trim(),
    );
    GM_setValue(
      "cfgCustomRule_" + room,
      document.getElementById("cfg-custom-rule").value.trim(),
    );
    GM_setValue("cfgLen", document.getElementById("cfg-len").value);
    const saveStyleValue = document.getElementById("cfg-style")?.value || "기본";
    GM_setValue("cfgStyle", saveStyleValue);

    const pov = saveStyleValue === "회고체" ? "1" : document.querySelector('input[name="cfg-pov"]:checked').value;
    GM_setValue("cfgPov", pov);
    GM_setValue(
      "cfgPovName",
      document.getElementById("cfg-pov-name").value.trim(),
    );

    GM_setValue("cfgRewrite", rewriteSlider.value);
    GM_setValue("cfgActive", activeSlider.value);

    const activeTones = Array.from(
      document.querySelectorAll(".tone-chip.active"),
    ).map((c) => c.dataset.val).filter(Boolean);
    GM_setValue("cfgTones", JSON.stringify(activeTones));

    for (let i = 1; i <= 10; i++) {
      GM_setValue(
        getLoreActiveKey(room, i),
        document.getElementById(`lore-active-${i}`).checked,
      );
      GM_setValue(
        getLoreTextKey(room, i),
        document.getElementById(`lore-text-${i}`).value.trim(),
      );
    }

    GM_setValue("cfgMemory", document.getElementById("cfg-memory").value);
    GM_setValue("cfgMarkdownMode", !!document.getElementById("cfg-markdown-mode")?.checked);

    // 번역 설정도 함께 확정 저장 (평소엔 실시간 저장이라 안전망)
    GM_setValue("cfgTransMode", document.querySelector('input[name="cfg-trans-mode"]:checked')?.value || "only");
    GM_setValue("cfgTransLang", document.getElementById("cfg-trans-lang").value);
    GM_setValue("cfgTransCustomLang", document.getElementById("cfg-trans-custom-lang").value.trim());
    GM_setValue("cfgTransFormat", document.getElementById("cfg-trans-format").value);
    GM_setValue("transNote_" + room, document.getElementById("cfg-trans-note").value);

    // 모델별 추론 입력값 저장
    const currentModel = document.getElementById("cfg-model").value;
    const thinkInput = document.getElementById("cfg-think-val");
    if (thinkInput) {
      if (currentModel.startsWith("deepseek-")) {
        GM_setValue("thinkDeepSeek_" + currentModel, thinkInput.value);
      } else if (currentModel.includes("gemini-3")) {
        GM_setValue("thinkLevel_" + currentModel, thinkInput.value);
      } else {
        let parsedBudget = parseInt(thinkInput.value) || 1024;
        if (parsedBudget < 128) parsedBudget = 128;
        GM_setValue("thinkBudget_" + currentModel, parsedBudget);
      }
    }
    alert("글로벌 설정이 저장되었습니다!");
  };

  function initPanelEvents() {
    const closePanelBtn = document.getElementById("close-panel");
    closePanelBtn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });
    closePanelBtn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });
    closePanelBtn.onclick = () =>
      (panel.style.display = "none");

    document.getElementById("cfg-save-btn").onclick = saveCfg;
    document.getElementById("cfg-markdown-mode")?.addEventListener("change", (e) => {
      GM_setValue("cfgMarkdownMode", !!e.target.checked);
    });
    document.getElementById("cfg-style")?.addEventListener("change", (e) => {
      const value = STYLE_DETAILS[e.target.value] !== undefined ? e.target.value : "기본";
      GM_setValue("cfgStyle", value);
      syncStylePovLock();
      hideStyleExample();
    });
    document.querySelectorAll(".tone-chip").forEach((chip) => {
      chip.onclick = () => {
        chip.classList.toggle("active");
        updateToneDetailBox();
      };
    });

    document.getElementsByName("cfg-pov").forEach((r) => {
      r.addEventListener("change", () => {
        syncStylePovLock();
      });
    });

    document.getElementById("cfg-memory").addEventListener("input", (e) => {
      document.getElementById("mem-val").innerText = e.target.value;
    });
    document.getElementById("cfg-len").addEventListener("input", (e) => {
      const preset = LEN_PRESETS[e.target.value] || LEN_PRESETS[3];
      document.getElementById("len-val").innerText = preset.label;
    });
    rewriteSlider.addEventListener("input", () => {
      rewriteDesc.innerText = rewriteTexts[rewriteSlider.value - 1];
    });
    activeSlider.addEventListener("input", () => {
      activeDesc.innerText = activeTexts[activeSlider.value - 1];
    });

    document.querySelectorAll(".acc-header").forEach((header) => {
      const arrowSpan = header.querySelector("span");

      header.addEventListener("mousedown", (e) => {
        e.stopPropagation();
      });

      header.addEventListener("click", () => {
        const target = document.getElementById(
          header.getAttribute("data-target"),
        );
        const isOpen = target.classList.contains("open");
        target.classList.toggle("open");
        if (arrowSpan) {
          arrowSpan.textContent = isOpen ? "▼" : "▲";
        }
      });
    });


    // 탭 전환
    document.querySelectorAll(".cmw-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".cmw-tab").forEach((t) => t.classList.remove("active"));
        document.querySelectorAll(".cmw-pane").forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        document.getElementById(tab.dataset.pane)?.classList.add("active");
      });
    });

    // 눈금 버튼 ↔ 숨은 슬라이더 연결
    document.querySelectorAll(".seg-group").forEach((group) => {
      const slider = document.getElementById(group.dataset.for);
      if (!slider) return;
      const syncSeg = () => {
        group.querySelectorAll(".seg-btn").forEach((b) => {
          b.classList.toggle("active", b.dataset.v === String(slider.value));
        });
      };
      group.querySelectorAll(".seg-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          slider.value = btn.dataset.v;
          slider.dispatchEvent(new Event("input"));
        });
      });
      slider.addEventListener("input", syncSeg);
      syncSeg();
    });

    initTransEvents();
  }

  initPanelEvents();
  bindStyleExampleTooltip();

  // =============================================
  // 6. LLM 통신 계층
  //    - requestLLM: 제공자(Google/Firebase/DeepSeek) 공통 전송부.
  //      집필과 번역이 같은 API 키/모델/추론 설정을 공유한다.
  // =============================================
  async function fetchChatHistory() {
    const path = location.pathname.match(
      /\/stories\/([^/]+)\/episodes\/([^/]+)/,
    );
    if (!path) return "(맥락 없음)";
    try {
      const token = getCrackAccessToken();
      const limit = GM_getValue("cfgMemory", 8);
      const res = await fetch(
        `${API_BASE}/v3/chats/${path[2]}/messages?limit=${limit}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );
      const json = await res.json();
      const msgs = (json.data ?? json).messages ?? [];
      return msgs
        .reverse()
        .map((m) => `[${m.role === "assistant" ? "상대" : "나"}]: ${m.content}`)
        .join("\n\n");
    } catch (e) {
      return "(맥락 로드 실패)";
    }
  }

  function requestLLM(sysPrompt, userContent, options = {}) {
    return new Promise(async (resolve, reject) => {
      const provider = GM_getValue("apiProvider", "google");
      const model = GM_getValue("cfgModel", "gemini-3.1-pro-preview");
      const temperature = typeof options.temperature === "number" ? options.temperature : 0.8;

      let genConfig = { temperature };

      const currentThinkingInput = document.getElementById("cfg-think-val");
      if (!model.startsWith("deepseek-")) {
        const savedLevel = GM_getValue("thinkLevel_" + model, "medium");
        const savedBudget = parseInt(GM_getValue("thinkBudget_" + model, 1024));

        const applyLevel =
          currentThinkingInput && model.includes("gemini-3")
            ? currentThinkingInput.value
            : savedLevel;
        let applyBudget =
          currentThinkingInput && !model.includes("gemini-3")
            ? parseInt(currentThinkingInput.value)
            : savedBudget;
        if (isNaN(applyBudget) || applyBudget < 128) applyBudget = 128;

        if (model.includes("gemini-3")) {
          delete genConfig.temperature;
          genConfig.thinkingConfig = { thinkingLevel: applyLevel };
        } else {
          genConfig.thinkingConfig = { thinkingBudget: applyBudget };
        }
      }

      if (provider === "deepseek") {
        const key = GM_getValue("deepSeekApiKey", "");
        if (!key) return reject(new Error("설정에서 DeepSeek API 키를 먼저 입력해주세요!"));

        const thinkingValue = currentThinkingInput?.value || GM_getValue("thinkDeepSeek_" + model, "on");
        const payload = {
          model,
          messages: [
            { role: "system", content: sysPrompt },
            { role: "user", content: userContent },
          ],
          stream: false,
          thinking: { type: thinkingValue === "off" ? "disabled" : "enabled" },
        };
        if (thinkingValue !== "off") payload.reasoning_effort = "high";

        GM_xmlhttpRequest({
          method: "POST",
          url: "https://api.deepseek.com/chat/completions",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          data: JSON.stringify(payload),
          onload: (res) => {
            try {
              const data = JSON.parse(res.responseText);
              if (data.error) return reject(new Error(data.error.message || "DeepSeek API 오류"));
              if (data.usage) updateCostUI(data.usage, model);

              let raw = data.choices?.[0]?.message?.content || "";
              raw = raw.trim().replace(/^```[^\n]*\n([\s\S]*?)\n```\s*$/m, "$1").trim();
              if (!raw) {
                const finish = data.choices?.[0]?.finish_reason || "";
                if (finish === "content_filter") return reject(new Error("딥시크 안전필터에 막혔습니다. 표현 수위를 낮추거나 다른 모델을 써보세요."));
                return reject(new Error("DeepSeek 응답 본문이 비어 있습니다. (사유: " + (finish || "알 수 없음") + ")"));
              }
              resolve(raw);
            } catch (e) {
              reject(new Error("DeepSeek 응답 분석 실패"));
            }
          },
          onerror: () => reject(new Error("DeepSeek 네트워크 오류")),
        });
        return;
      }

      if (provider === "firebase") {
        const configRaw = GM_getValue("firebaseScript", "");
        if (!configRaw)
          return reject(
            new Error("설정에서 Firebase 복사본을 먼저 입력해주세요!"),
          );

        let configObj;
        let fbVersion = "12.12.0";

        try {
          const versionMatch = configRaw.match(
            /firebasejs\/([0-9.]+)\/firebase-app\.js/,
          );
          if (versionMatch && versionMatch[1]) fbVersion = versionMatch[1];

          const match = configRaw.match(
            /const\s+firebaseConfig\s*=\s*({[\s\S]*?});/,
          );
          if (match && match[1]) {
            configObj = new Function("return " + match[1])();
          } else {
            const fallbackMatch = configRaw.match(
              /({[\s\S]*?apiKey[\s\S]*?appId[\s\S]*?})/,
            );
            if (fallbackMatch && fallbackMatch[1])
              configObj = new Function("return " + fallbackMatch[1])();
            else throw new Error("형식 오류");
          }
        } catch (e) {
          return reject(
            new Error(
              "Firebase 코드를 해독하지 못했습니다. 파이어베이스 홈페이지에서 준 <script> 태그 포함된 코드를 그대로 넣어주세요.",
            ),
          );
        }

        try {
          const appUrl = `https://www.gstatic.com/firebasejs/${fbVersion}/firebase-app.js`;
          const majorVersion = parseInt(fbVersion.split(".")[0]);
          const aiUrl =
            majorVersion >= 12
              ? `https://www.gstatic.com/firebasejs/${fbVersion}/firebase-ai.js`
              : `https://www.gstatic.com/firebasejs/${fbVersion}/firebase-vertexai.js`;

          const { initializeApp, getApps, getApp } = await import(appUrl);
          let ai, generativeModel;

          if (majorVersion >= 12) {
            const {
              HarmBlockThreshold,
              HarmCategory,
              getAI,
              getGenerativeModel,
              VertexAIBackend,
            } = await import(aiUrl);
            const apps = getApps();
            const app = apps.length === 0 ? initializeApp(configObj) : getApp();
            ai = getAI(app, { backend: new VertexAIBackend("global") });

            const safetySettings = [
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
            ];

            generativeModel = getGenerativeModel(ai, {
              model: model,
              safetySettings,
              systemInstruction: { parts: [{ text: sysPrompt }] },
              generationConfig: genConfig,
            });
          } else {
            const {
              HarmBlockThreshold,
              HarmCategory,
              getVertexAI,
              getGenerativeModel,
            } = await import(aiUrl);
            const apps = getApps();
            const app = apps.length === 0 ? initializeApp(configObj) : getApp();
            ai = getVertexAI(app);

            const safetySettings = [
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
            ];

            generativeModel = getGenerativeModel(ai, {
              model: model,
              safetySettings,
              systemInstruction: { parts: [{ text: sysPrompt }] },
              generationConfig: genConfig,
            });
          }

          const result = await generativeModel.generateContent(userContent);

          if (result.response && result.response.usageMetadata) {
            updateCostUI(result.response.usageMetadata, model);
          }

          let rawResult = result.response.text().trim();
          rawResult = rawResult.replace(/^```[^\n]*\n([\s\S]*?)\n```\s*$/m, "$1").trim();
          resolve(rawResult);
        } catch (e) {
          reject(new Error("Firebase Vertex 통신 실패: " + e.message));
        }
      } else {
        const key = GM_getValue("apiKey", "");
        if (!key)
          return reject(new Error("설정에서 API 키를 먼저 입력해주세요!"));

        GM_xmlhttpRequest({
          method: "POST",
          url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          headers: { "Content-Type": "application/json" },
          data: JSON.stringify({
            system_instruction: { parts: [{ text: sysPrompt }] },
            contents: [{ parts: [{ text: userContent }] }],
            generationConfig: genConfig,
          }),
          onload: (res) => {
            try {
              const data = JSON.parse(res.responseText);
              if (data.error) reject(new Error(data.error.message));
              else {
                if (data.usageMetadata) {
                  updateCostUI(data.usageMetadata, model);
                }

                let raw = data.candidates[0].content.parts[0].text.trim();
                raw = raw.replace(/^```[^\n]*\n([\s\S]*?)\n```\s*$/m, "$1").trim();
                resolve(raw);
              }
            } catch (e) {
              reject(new Error("응답 분석 실패"));
            }
          },
          onerror: () => reject(new Error("네트워크 오류")),
        });
      }
    });
  }

  // =============================================
  // 6-1. 집필 프롬프트 (기존 callGemini)
  // =============================================
  async function callGemini(baseText) {
      const room = getChatRoomId();
      const history = await fetchChatHistory();
      const profileInfo = await refreshCurrentProfileFromApi(true).catch(() => {
        scanProfileFromDomFallback();
        return readStoredProfile(room);
      });
      const name = profileInfo?.name || GM_getValue("scannedCharName_" + room, "");
      const prof = profileInfo?.profile || GM_getValue("scannedCharProfile_" + room, "");

      const pcNote = GM_getValue("cfgPcNote_" + room, "");
      const customRule = GM_getValue("cfgCustomRule_" + room, "");

      const rewriteLevel = GM_getValue("cfgRewrite", 2);
      const activeLevel = GM_getValue("cfgActive", 2);
      const rawPov = GM_getValue("cfgPov", "1");
      const povName = GM_getValue("cfgPovName", "");
      const lenLevel = GM_getValue("cfgLen", 3);
      const lenChars = (LEN_PRESETS[lenLevel] || LEN_PRESETS[3]).chars;
      const savedStyleMode = GM_getValue("cfgStyle", "기본");
      const currentStyleValue = document.getElementById("cfg-style")?.value || "";
      const styleMode = STYLE_DETAILS[currentStyleValue] !== undefined ? currentStyleValue : savedStyleMode;
      const pov = styleMode === "회고체" ? "1" : rawPov;
      const styleInstruction = STYLE_DETAILS[styleMode] || "";
      const toneList = JSON.parse(GM_getValue("cfgTones", "[]"));
      const tones = toneList.join(", ");
      const hasMoanTone = toneList.includes("신음");

      const activeLores = [];
      for (let i = 1; i <= 10; i++) {
        const loreActive = GM_getValue(getLoreActiveKey(room, i), false);
        const loreText = GM_getValue(getLoreTextKey(room, i), "");
        if (loreActive && loreText) {
          activeLores.push(loreText);
        }
      }

      let povInstruct =
        pov === "1"
          ? styleMode === "회고체"
            ? "1인칭 시점으로 서술한다. 회고체에서는 자칭을 '저/제'로 쓰고 '나/내'는 쓰지 않는다."
            : "1인칭 시점으로 서술한다. 지문·행동 묘사·내면 서술은 PC의 1인칭 관점에서 작성한다."
          : `${povName || name || "캐릭터"} 중심의 3인칭 시점으로 서술한다. 지문·행동 묘사·내면 서술에서 PC를 '나/내/저/제' 같은 1인칭 자칭으로 부르지 말고, 이름이나 3인칭 지칭으로 서술한다. 직접 대사 안에서만 캐릭터 말투에 맞는 1인칭 표현을 사용할 수 있다.`;

      const lenGuides = {
        1: `한국어 기준 약 ${lenChars}자 안팎으로 짧고 속도감 있게 끊어 쓰십시오. 이보다 길게 늘이지 마십시오.`,
        2: `한국어 기준 약 ${lenChars}자 안팎으로 작성하십시오. 글자 수에 집착해 문장을 어색하게 늘리거나 끊지는 말되, 목표 분량에서 ±50자 정도만 벗어나는 선에서 맞추십시오.`,
        3: `한국어 기준 약 ${lenChars}자 안팎으로 작성하십시오. 글자 수에 집착해 문장을 어색하게 늘리거나 끊지는 말되, 목표 분량에서 ±50자 정도만 벗어나는 선에서 맞추십시오.`,
        4: `한국어 기준 약 ${lenChars}자 안팎으로, 너무 짧지 않게 충분히 채워 쓰십시오. 다만 목표 분량에서 ±50자 정도만 벗어나는 선을 지키고, 그보다 길게 늘이지는 마십시오.`,
        5: `한국어 기준 약 ${lenChars}자 안팎으로, 아주 길고 볼륨감 있게 장면을 꽉 채워 쓰십시오. 절대 짧게 끝내지는 말되, 목표 분량에서 +100자 이상 넘기지는 마십시오.`,
      };
      let lenInstruction = lenGuides[lenLevel] || lenGuides[3];

      let sysPromptParts = [];

      sysPromptParts.push(`[역할]
당신은 사용자의 롤플레잉 입력을 현재 대화 맥락에 맞춰 다듬거나, 입력이 없을 때 다음 턴을 이어 쓰는 보조 작가입니다. 사용자의 PC 관점·의도·방별 설정을 최우선으로 따르되, 단순 교정을 넘어 장면이 생생하게 살아나도록 문장을 완성하는 것이 목표입니다.

입력이나 이전 맥락에 정리된 형식이 섞여 있더라도, 그 형식을 출력 양식으로 따라 쓰지 말고 장면 안의 서술·행동·감각·내면·대사로만 풀어 쓰십시오.

최종 출력은 사용자가 그대로 채팅 입력창에 붙여넣을 수 있는 롤플레잉 본문만 작성하십시오.`);

      let baseInfoLines = [`- 시점: ${povInstruct}`];
      if (name || prof) {
        baseInfoLines.push(`- 감지된 대화 프로필(PC/페르소나): 이름 [${name || "미상"}], 설정 [${prof || "미상"}]`);
      }
      sysPromptParts.push(`[현재 기준 정보]
${baseInfoLines.join("\n")}`);

      if (pcNote) {
        sysPromptParts.push(`[PC 추가 설정]
${pcNote}`);
      }

      if (customRule) {
        sysPromptParts.push(`[사용자 커스텀 규칙 - 최우선]
${customRule}
위 규칙은 일반 출력 지침보다 우선합니다.`);
      }

      if (activeLores.length > 0) {
        sysPromptParts.push(`[절대 세계관 규칙]
${activeLores.join("\n")}`);
      }

      sysPromptParts.push(`[캐릭터 경계]
PC(사용자 캐릭터)의 말과 행동에 집중하십시오. 상대 캐릭터/NPC에 대해서는 그들의 결정적 선택, 장기적 행보, 숨겨진 속마음, 핵심 대사를 임의로 확정하지 마십시오. 다만 PC의 시야에 자연스럽게 들어오는 상대의 짧은 표정, 반사적 몸짓, 침묵, 말끝, 거리감, 주변 반응 등은 장면 몰입을 위해 묘사해도 됩니다. 이 경계의 강도는 아래 [PC 능동성]의 단계 지시에 맞춰 조절하되, 어느 단계에서도 상대의 운명을 대신 결정짓는 수준까지는 넘어가지 마십시오.`);

      sysPromptParts.push(`[분량 통제]
${lenInstruction}`);

      // 변형도: 입력 문장 자체를 얼마나 고칠지 (입력이 있을 때만 의미 있음)
      const rewriteInstr = {
        1: "입력한 문장을 거의 그대로 유지하고 맞춤법·띄어쓰기만 손보십시오. 입력 문장 자체를 새로 부풀리거나 바꾸지 마십시오.",
        2: "입력의 본래 의미를 유지하되, PC의 성격·말투에 맞게 어휘와 어투만 자연스럽게 다듬으십시오. 입력에 없던 사건을 새로 만들지는 마십시오.",
        3: "입력의 핵심 의도를 보존하면서, 말투를 PC에 맞추고 문장의 리듬과 표현을 한층 매끄럽고 생생하게 윤문하십시오.",
        4: "입력의 의도를 읽고, 그에 어울리도록 표현을 적극적으로 풍성하게 확장해 전문 웹소설처럼 밀도 있게 다듬으십시오.",
        5: "입력의 핵심 의도만 남기고 문장을 자유롭게 재구성해, 가장 극적이고 몰입감 있는 표현으로 새로 써내십시오. 단, 입력에 담긴 본래 의도와 방향은 배신하지 마십시오.",
      };

      // 능동성: PC가 장면을 얼마나 주도·전개할지 (입력 유무와 무관하게 항상 적용)
      const activeInstr = {
        1: "PC의 행동과 전개를 극도로 아끼고 조용히 관망하십시오. 새로운 행동이나 사건을 더하지 말고 최소한의 반응으로만 장면에 머무르십시오.",
        2: "현재 흐름에 자연스럽게 호응하는 선에서만 PC를 움직이십시오. 상황을 크게 흔들지 않고 분위기만 부드럽게 이어가십시오.",
        3: "맥락과 PC 설정을 살려, 엉뚱한 새 사건 없이 지금 상황 안에서 PC의 다음 행동과 반응을 자연스럽게 전개하십시오.",
        4: "PC의 감정과 의지를 적극적으로 드러내어 장면의 분위기를 주도하십시오. 단, 상대 캐릭터/NPC의 선택과 대사를 대신 확정하지는 마십시오.",
        5: "지금 상황 안에서 PC가 보일 수 있는 가장 결단력 있고 몰입감 높은 언행을 창작해 장면을 강하게 끌고 가십시오. 단, 맥락에 없던 사건이나 외부 변수를 새로 터뜨리지는 마십시오.",
      };

      if (baseText) {
        sysPromptParts.push(`[입력 다듬기 강도]
${rewriteInstr[rewriteLevel] || rewriteInstr[2]}`);
        sysPromptParts.push(`[PC 능동성]
${activeInstr[activeLevel] || activeInstr[2]}
'입력 다듬기 강도'는 사용자가 입력한 문장 자체를 얼마나 고칠지를, 'PC 능동성'은 그 입력 주변에 PC의 행동·전개를 얼마나 더할지를 정합니다. 둘은 별개이니, 입력 문장은 강도 지시에 맞게 보존·변형하면서도 능동성 수준에 맞는 행동·반응을 자연스럽게 덧붙이십시오.`);

        sysPromptParts.push(`[짧은 입력 확장 원칙]
사용자의 입력이 짧을 때는 대사 자체만 기계적으로 늘리지 말고, 이전 맥락을 읽어 그 말이나 행동에 이르게 된 PC의 사고, 태도, 사소한 움직임, 주변 감각을 자연스럽게 보태어 장면을 완성하십시오.

다만 확장의 폭은 반드시 [입력 다듬기 강도], [PC 능동성], [분량 통제]를 따릅니다. 다듬기 강도가 낮으면 입력 문장 자체는 보존하고 전후의 분위기만 얇게 보강하십시오. 능동성이 낮을수록 최소한의 반응과 감각 보강에 머무르고, 능동성이 높을수록 PC의 의지와 행동을 더 선명하게 드러내십시오.

입력이 이미 충분히 구체적이면 억지로 부풀리지 말고, 입력의 의도와 방향을 배신하지 마십시오. 맥락에 없던 새 사건이나 외부 변수를 억지로 만들지 마십시오.`);
      } else {
        sysPromptParts.push(`[PC 능동성]
${activeInstr[activeLevel] || activeInstr[2]}`);
      }

      const toneSummary = tones ? tones : "별도 지정 없음";
      sysPromptParts.push(`[분위기]
- 요구 분위기: [${toneSummary}]
- 지정된 분위기가 답변 전체에서 분명히 느껴지도록 색을 입히십시오.
- 감정은 직접 나열해 설명하기보다 시선·호흡·손끝·거리감·말끝·침묵·주변 소리 같은 감각으로 보여주는 것을 기본으로 하되, 장면의 정서가 고조되는 순간에는 PC의 속마음을 직접 드러내도 좋습니다.
- 장면을 훈계하듯 요약하며 닫지 말고, 진행 중인 행동·반응·말끝으로 여운을 남기며 끝내십시오.
- 맥락과 무관한 과거사 설명이나 장황한 독백으로 분량을 늘리지는 마십시오.`);

      if (toneList.length >= 2) {
        sysPromptParts.push(`[분위기 융합]
여러 분위기가 동시에 지정되었습니다. 어느 하나만 택하지 말고 한 장면 안에 자연스럽게 녹여 섞으십시오. 다만 서로 상충하는 정서(예: 밝은 코믹과 무거운 피폐)가 함께 지정된 경우, 둘을 어색하게 평균 내지 말고 현재 맥락에 더 어울리는 정서를 중심축으로 삼되 다른 정서는 그 위에 음영처럼 얹으십시오.`);
      }

      if (hasMoanTone) {
        sysPromptParts.push(`[선택 분위기 세부 지침]
${MOAN_TONE_INSTRUCTION}`);
      }

      const toneDetailParts = toneList
        .map((t) => TONE_DETAILS[t])
        .filter(Boolean);
      if (toneDetailParts.length > 0) {
        sysPromptParts.push(`[선택 분위기 연출 방향]\n${toneDetailParts.join("\n")}`);
      }

      if (styleInstruction) {
        sysPromptParts.push(`[문체 — 선택한 서술 방식]
${styleInstruction}`);
      }

      sysPromptParts.push(`[출력 형식]
- 출력은 사용자가 그대로 붙여넣을 롤플레잉 본문만 작성하십시오.
- 행동·묘사·내면 서술은 *...*, 직접 발화는 "..."를 기본으로 하되, 선택된 시점을 반드시 따르십시오. 현재 채팅방에 이미 굳어진 롤플레잉 본문 양식이 있으면 그 양식을 우선하되, 입력·이전 맥락에 섞인 정리 형식은 출력 양식으로 보지 마십시오.
- 3인칭 시점에서는 *...* 안의 내면 서술도 1인칭 자칭(나/내/저/제)으로 쓰지 말고, PC를 이름이나 3인칭 지칭으로 서술하십시오. 단, 직접 대사 안에서는 캐릭터 말투에 맞는 1인칭 표현을 사용할 수 있습니다.
- 사용자는 입력 시 대사를 따옴표 없이 일반 텍스트로, 행동·묘사·내면 서술을 * * 기호로 감싸 구분할 수 있습니다. 이 입력 양식을 해석에 반영하십시오.
- 메타 설명, 선택지 제안, 분석문, 사과문, 안내문은 출력하지 마십시오.`);

      sysPromptParts.push(`[최종 금지사항]
- 상대 캐릭터/NPC의 핵심 대사와 깊은 내면을 대신 확정하지 마십시오.
- 작위적인 요약, 수사학적 질문, 교훈조 마무리, 다음 전개 예고로 글을 닫지 마십시오.
- 답변 전체를 하나의 코드블록으로 감싸지 마십시오.`);

      sysPromptParts.push(`[핵심 재확인 — 반드시 지킬 것]
- 시점: ${povInstruct}.
- 분량: ${lenInstruction}
- 상대 캐릭터/NPC의 핵심 대사와 결정은 대신 쓰지 말고 PC만 움직일 것.`);


      if (GM_getValue("cfgMarkdownMode", false)) {
        sysPromptParts.push(CRACK_MARKDOWN_INSTRUCTION);
      }

      let sysPrompt = sysPromptParts.filter(Boolean).join("\n\n");

      let userContent = "";

      if (baseText) {
        userContent = `[이전 맥락]\n${history}\n\n[입력된 뼈대 문장]\n${baseText}\n\n위 내용을 뼈대로 지시사항에 맞춰 집필해.`;
      } else {
        userContent = `[이전 맥락]\n${history}\n\n[자동 이어쓰기 요청]\n사용자의 입력이 없습니다. 위 대화 맥락을 완벽히 읽고, 지시사항(특히 'PC 능동성')에 맞춰 당신이 직접 다음 턴(사용자 캐릭터의 반응)을 상상하여 100% 창작해 주십시오.`;
      }

      return requestLLM(sysPrompt, userContent, { temperature: 0.8 });
  }

  // =============================================
  // 6-2. 번역 프롬프트 (구 'AI 캐릭터 맞춤 번역기')
  //      *...* / **...** 로 감싼 서술은 한국어 그대로 두고,
  //      대사만 목표 언어로 번역해 출력 형식에 맞춰 반환한다.
  // =============================================
  function buildTranslateSysPrompt() {
    const room = getChatRoomId();
    const lang = getTargetLang();
    const { pattern, example, includesOriginal } = buildTransFormatInstruction();
    const note = (GM_getValue("transNote_" + room, "") || "").trim();

    let sysPrompt = `You are a roleplay dialogue translator. Translate the user's roleplay text to ${lang}.
Rules:
1. Any narration/action/inner-monologue wrapped in asterisks (*...* or **...**) must remain in the original Korean, EXACTLY as written. Do NOT translate or alter it.
2. Translate only the spoken dialogue (text outside the asterisk wrapping) into ${lang}.
3. 🚨CRITICAL: Output each dialogue segment EXACTLY in this format: ${pattern}`;

    if (!includesOriginal) {
      sysPrompt += `\n   Do NOT append the original Korean dialogue. Output only what the format specifies.`;
    }

    sysPrompt += `
4. Preserve line breaks and the overall structure of the input.
Example Input: *손을 흔들며* 안녕, 반가워!
Example Output: *손을 흔들며* ${example}`;

    if (note) {
      sysPrompt += `\n5. Apply this persona/speaking style to the translated dialogue: ${note}`;
    }

    sysPrompt += `\nOutput only the converted roleplay text. No explanations, no preamble.`;
    return sysPrompt;
  }

  function callTranslate(sourceText) {
    return requestLLM(buildTranslateSysPrompt(), sourceText, { temperature: 0.3 });
  }

  // =============================================
  // 7. UI 자동 주입
  //    - ✍️ 아이콘 버튼 = 모델 버튼 옆 (아이콘 전용)
  //    - 사이드바 'AI 집필 설정' 행 = '키보드 단축키' 아래 (Scene Painter 행이 있으면 그 아래)
  //    - 히스토리·🌐 번역·✨ 집필 = 전송 버튼 좌측
  // =============================================
  let currentRoomId = "";

  function getChatInput() {
    return (
      document.querySelector(".__chat_input_textarea") ||
      document.querySelector('div[contenteditable="true"][translate="no"]') ||
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector("textarea")
    );
  }

  function updateChatInputFromHistory() {
    const chatInput = getChatInput();
    if (!chatInput || generatedHistory.length === 0) return;

    const textToInsert = generatedHistory[historyIndex] || "";

    if (chatInput.tagName === "TEXTAREA") {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;

      if (setter) setter.call(chatInput, textToInsert);
      else chatInput.value = textToInsert;

      chatInput.style.height = "auto";
      chatInput.style.height = chatInput.scrollHeight + "px";
    } else {
      chatInput.innerText = textToInsert;
    }

    chatInput.dispatchEvent(new Event("input", { bubbles: true }));
    chatInput.focus();

    const ht = document.getElementById("history-text");
    if (ht) ht.innerText = `${historyIndex + 1}/${generatedHistory.length}`;
  }

  function resetHistory() {
    generatedHistory = [];
    historyIndex = -1;

    const w = document.getElementById("crack-history-widget");
    if (w) w.style.display = "none";
  }

  function pushHistory(text) {
    generatedHistory.push(text);
    historyIndex = generatedHistory.length - 1;
    updateChatInputFromHistory();

    const w = document.getElementById("crack-history-widget");
    if (w && generatedHistory.length > 1) w.style.display = "flex";
  }

  // ---------------------------------------------
  // 전송 버튼 탐색 (클래스 row 탐색 + 위치/fixed 안전 필터)
  // 다른 확프(HUD)·말풍선·좌측툴바를 환경 무관하게 배제
  // ---------------------------------------------
  function findSendButton() {
    const input = getChatInput();
    if (!input) return null;

    const inRect = input.getBoundingClientRect();
    const inputMidY = inRect.top + inRect.height / 2;
    const inputCx = inRect.left + inRect.width / 2;

    // 후보 버튼이 "진짜 composer 전송 버튼"인지 위치로 검증
    const isComposerButton = (b) => {
      if (!b || b.contains(input)) return false;
      if ((b.id || "").startsWith("crack-")) return false;
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;       // 비가시
      const cy = r.top + r.height / 2;
      // 입력창보다 위쪽(=상단 HUD/스탯바)이면 배제. 같은 줄~아래만 허용.
      if (cy < inputMidY - 40) return false;
      // 입력창 중심보다 왼쪽(=좌측 툴바)이면 배제.
      if (r.left + r.width / 2 < inputCx) return false;
      // fixed로 떠다니는 다른 확프 컨테이너 안이면 배제(HUD/FAB 방어).
      let p = b;
      for (let i = 0; i < 6 && p && p !== document.body; i++, p = p.parentElement) {
        if (getComputedStyle(p).position === "fixed") return false;
      }
      return true;
    };

    // 1순위: justify-between row의 직계 버튼 중 검증 통과한 마지막
    let node = input;
    for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
      if (!(node instanceof HTMLElement) || !node.querySelectorAll) continue;
      const rows = Array.from(node.querySelectorAll("div.justify-between"));
      for (let r = rows.length - 1; r >= 0; r--) {
        const btns = Array.from(rows[r].children || []).filter(
          (c) => c.tagName === "BUTTON" && isComposerButton(c),
        );
        if (btns.length > 0) return btns[btns.length - 1];
      }
    }

    // 폴백: 좌측 그룹(space-x-2) 제외 flex row의 검증 통과한 마지막 버튼
    node = input;
    for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
      if (!(node instanceof HTMLElement) || !node.querySelectorAll) continue;
      const rows = Array.from(node.querySelectorAll("div.flex")).filter(
        (d) => !d.classList.contains("space-x-2"),
      );
      for (let r = rows.length - 1; r >= 0; r--) {
        const btns = Array.from(rows[r].children || []).filter(
          (c) => c.tagName === "BUTTON" && isComposerButton(c),
        );
        if (btns.length > 0) return btns[btns.length - 1];
      }
    }

    // 최종 폴백: 조상 전체에서 검증 통과한 가장 오른쪽 버튼
    node = input.parentElement;
    for (let i = 0; i < 10 && node; i++, node = node.parentElement) {
      if (!(node instanceof HTMLElement) || !node.querySelectorAll) continue;
      const cands = Array.from(node.querySelectorAll("button")).filter(isComposerButton);
      if (cands.length > 0) {
        cands.sort(
          (a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right,
        );
        return cands[0];
      }
    }

    return null;
  }

  // ---------------------------------------------
  // 모델 선택 버튼 탐색 (다단계 폴백)
  // ---------------------------------------------
  function findModelButton() {
    const all = Array.from(document.querySelectorAll("button"));

    // 1순위: 기존 모델 아이콘 이미지 포함 버튼
    let btn = all.find((b) => b.querySelector('img[src*="model-icon"]'));
    if (btn) return btn;

    // 2순위: 버튼 내부에 모델명/드롭다운 성격이 있는 버튼
    btn = all.find((b) => {
      if (b.id && b.id.startsWith("crack-")) return false;
      const txt = (b.textContent || "").toLowerCase();
      const hasModelText = /gemini|gpt|claude|모델|model/i.test(txt);
      const hasIcon = b.querySelector('img[src*="model"], svg');
      return hasModelText && hasIcon;
    });
    if (btn) return btn;

    // 3순위: model 문자열을 가진 img를 포함한 버튼
    btn = all.find((b) => b.querySelector('img[src*="model"]'));
    if (btn) return btn;

    return null;
  }

  // ---------------------------------------------
  // ✍️ 집필 설정 버튼: 모델 버튼 옆 (아이콘 전용)
  // ---------------------------------------------
  function createSettingsButton() {
    const sBtn = document.createElement("button");
    sBtn.id = "crack-pure-settings-btn";
    sBtn.type = "button";
    sBtn.className = "crack-pure-settings";
    sBtn.title = "AI 집필 설정";
    sBtn.setAttribute("aria-label", "AI 집필 설정");
    sBtn.innerHTML = `✍️`;
    sBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePanelVisibility();
    });
    return sBtn;
  }

  function injectSettingsButton() {
    let sBtn = document.getElementById("crack-pure-settings-btn");
    const modelBtn = findModelButton();

    // 모델 버튼을 못 찾으면 이번 루프는 건너뛰고 다음 루프에서 재시도
    if (!modelBtn || !modelBtn.parentNode) return;

    // 로어 버튼이 같은 버튼 그룹에 있으면 로어 바로 왼쪽에 붙는다.
    // UI+ 로어 보정은 "로어 버튼 바로 오른쪽 = 모델 버튼"을 제자리로 보므로,
    // 집필 설정 버튼이 모델 버튼 바로 앞을 계속 빼앗지 않게 한 칸 왼쪽으로 비켜선다.
    const loreButton = document.getElementById("lore-inj-entry-button");
    const anchor =
      loreButton &&
      loreButton.isConnected &&
      loreButton.parentElement === modelBtn.parentElement
        ? loreButton
        : modelBtn;

    if (!sBtn || !sBtn.isConnected) {
      sBtn = createSettingsButton();
      anchor.parentNode.insertBefore(sBtn, anchor);
      return;
    }

    // 재렌더/이동으로 위치가 틀어졌으면 앵커 바로 앞으로만 복귀
    // 로어가 있으면 ✍️ → 로어 → 모델, 로어가 없으면 ✍️ → 모델.
    if (sBtn.parentNode !== anchor.parentNode || sBtn.nextElementSibling !== anchor) {
      anchor.parentNode.insertBefore(sBtn, anchor);
    }
  }

  // ---------------------------------------------
  // 사이드바 'AI 집필 설정' 행
  //  - Scene Painter '배경 이미지 보기' 행과 같은 결/위치 규칙.
  //  - '키보드 단축키' 행 아래. Scene Painter 행이 있으면 그 아래에 붙어
  //    두 확프가 자리를 두고 싸우지 않는다.
  // ---------------------------------------------
  const CMW_SIDEBAR_ROW_ID = "cmw-writer-settings-row";

  function findKeyboardShortcutRowCmw() {
    const excludeSelector = `#${CMW_SIDEBAR_ROW_ID}, #sgb-bg-settings-row, [data-sgb-settings-row], #sgb-bg-settings-modal`;

    const controls = Array.from(document.querySelectorAll('[class*="ring-offset-sidebar"], [role="button"], button'));
    const target = controls.find((el) => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.closest(excludeSelector)) return false;
      return String(el.textContent || "").trim().includes("키보드 단축키");
    });

    if (target instanceof HTMLElement) {
      const row = target.closest('div[class*="px-2.5"][class*="py-[18px]"], div[class*="px-2.5"][class*="box-content"], div[class*="py-[18px]"][class*="h-4"]');
      if (row instanceof HTMLElement) return row;
      if (target.parentElement instanceof HTMLElement) return target.parentElement;
    }

    // fallback: 클래스 구조가 바뀌어도 텍스트 기준으로 한 번 더 찾는다.
    const labels = Array.from(document.querySelectorAll('span.whitespace-nowrap, span[class*="typo-text-sm"], span'));
    const label = labels.find((el) => el instanceof HTMLElement && el.textContent?.trim() === "키보드 단축키" && !el.closest(excludeSelector));
    if (!(label instanceof HTMLElement)) return null;

    for (let cur = label; cur && cur !== document.body; cur = cur.parentElement) {
      if (!(cur instanceof HTMLElement)) continue;
      const cls = String(cur.className || "");
      if (
        cls.includes("px-2.5") ||
        (cls.includes("box-content") && cls.includes("h-4")) ||
        cls.includes("py-[18px]")
      ) {
        return cur;
      }
    }

    return label.closest("div");
  }

  function createCmwSidebarRow() {
    const row = document.createElement("div");
    row.id = CMW_SIDEBAR_ROW_ID;
    row.className = "px-2.5 h-4 box-content py-[18px]";

    row.innerHTML = `
      <div role="button" tabindex="0" class="w-full flex h-4 items-center justify-between typo-text-base_leading-none_medium space-x-2 ring-offset-4 ring-offset-sidebar cursor-pointer">
        <span class="flex space-x-2 items-center min-w-0">
          <span style="font-size:17px; line-height:1; width:24px; text-align:center; flex:none;">✍️</span>
          <span class="whitespace-nowrap overflow-hidden text-ellipsis typo-text-sm_leading-none_medium">AI 집필 설정</span>
        </span>
        <span style="font-size:11px; color:var(--text_secondary); flex:none;">열기 ›</span>
      </div>
    `;

    const openRow = row.querySelector('[role="button"]');
    openRow.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePanelVisibility();
    });
    openRow.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      togglePanelVisibility();
    });

    return row;
  }

  function injectSidebarRow() {
    const kbRow = findKeyboardShortcutRowCmw();
    if (!(kbRow instanceof HTMLElement) || !kbRow.parentElement) return;

    // Scene Painter 행이 같은 목록 안에 살아 있으면 그 아래에 붙는다.
    const sgbRow = document.getElementById("sgb-bg-settings-row");
    const anchor =
      sgbRow instanceof HTMLElement &&
      sgbRow.isConnected &&
      sgbRow.parentElement === kbRow.parentElement
        ? sgbRow
        : kbRow;

    const existing = document.getElementById(CMW_SIDEBAR_ROW_ID);
    if (existing instanceof HTMLElement && existing.isConnected) {
      // 제자리에 있으면 손대지 않아 React·Scene Painter와 자리다툼하지 않는다.
      if (existing.previousElementSibling !== anchor || existing.parentElement !== anchor.parentElement) {
        anchor.insertAdjacentElement("afterend", existing);
      }
      return;
    }

    document.querySelectorAll(`#${CMW_SIDEBAR_ROW_ID}`).forEach((el) => el.remove());
    anchor.insertAdjacentElement("afterend", createCmwSidebarRow());
  }

  // ---------------------------------------------
  // 전송 버튼 좌측 wrapper: 히스토리 + 🌐 번역 + ✨ 집필
  // ---------------------------------------------
  function buildWrapperContents(wrapper) {
    wrapper.replaceChildren();

    // 1) 히스토리 위젯
    const hWidget = document.createElement("div");
    hWidget.id = "crack-history-widget";
    hWidget.className = "crack-history-widget";
    hWidget.innerHTML = `
      <span class="crack-history-btn" id="history-prev">◀</span>
      <span id="history-text">1/1</span>
      <span class="crack-history-btn" id="history-next">▶</span>
    `;

    hWidget.querySelector("#history-prev").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (historyIndex > 0) {
        historyIndex--;
        updateChatInputFromHistory();
      }
    });

    hWidget.querySelector("#history-next").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (historyIndex < generatedHistory.length - 1) {
        historyIndex++;
        updateChatInputFromHistory();
      }
    });

    // 2) 🌐 번역 버튼 (모드에 따라 번역만 / 집필 후 번역)
    const tBtn = document.createElement("button");
    tBtn.id = "crack-pure-trans-btn";
    tBtn.type = "button";
    tBtn.className = "crack-pure-trans";
    tBtn.title = "번역 (설정의 번역 탭에서 모드 변경)";
    tBtn.innerHTML = `<span id="trans-icon" style="font-size: 14px;">🌐</span>`;
    tBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const chatInput = getChatInput();
      if (!chatInput) return alert("채팅 입력창을 찾을 수 없습니다.");

      const baseText =
        chatInput.tagName === "TEXTAREA"
          ? chatInput.value
          : chatInput.innerText;

      const mode = GM_getValue("cfgTransMode", "only");
      if (mode === "only" && !baseText.trim()) {
        return alert("번역할 텍스트를 입력창에 먼저 적어주세요.\n(빈 입력으로 이어쓰기+번역을 원하면 번역 탭에서 '집필 후 번역'을 선택하세요.)");
      }

      const icon = document.getElementById("trans-icon");
      if (icon) {
        icon.innerHTML = "⏳";
        icon.classList.add("spin-anim");
      }
      tBtn.disabled = true;

      try {
        if (generatedHistory.length === 0) generatedHistory.push(baseText);

        let source = baseText;
        if (mode === "write") {
          // 1단계: 집필(부풀리기). 한국어 결과도 히스토리에 남겨 ◀로 되돌릴 수 있게 한다.
          if (icon) icon.innerHTML = "✏️";
          source = await callGemini(baseText);
          pushHistory(source);
          if (icon) icon.innerHTML = "⏳";
        }

        const translated = await callTranslate(source);
        pushHistory(translated);
      } catch (err) {
        alert(err.message);
      } finally {
        if (icon) {
          icon.innerHTML = "🌐";
          icon.classList.remove("spin-anim");
        }
        tBtn.disabled = false;
      }
    });

    // 3) ✨ 집필 버튼
    const gBtn = document.createElement("button");
    gBtn.id = "crack-pure-magic-btn";
    gBtn.type = "button";
    gBtn.className = "crack-pure-magic";
    gBtn.title = "AI 집필 (다듬기/이어쓰기)";
    gBtn.innerHTML = `<span id="magic-icon" style="font-size: 14px;">✨</span>`;
    gBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const chatInput = getChatInput();
      if (!chatInput) return alert("채팅 입력창을 찾을 수 없습니다.");

      const baseText =
        chatInput.tagName === "TEXTAREA"
          ? chatInput.value
          : chatInput.innerText;

      const icon = document.getElementById("magic-icon");
      if (icon) {
        icon.innerHTML = "⏳";
        icon.classList.add("spin-anim");
      }

      try {
        if (generatedHistory.length === 0) generatedHistory.push(baseText);

        const result = await callGemini(baseText);
        pushHistory(result);
      } catch (err) {
        alert(err.message);
      } finally {
        if (icon) {
          icon.innerHTML = "✨";
          icon.classList.remove("spin-anim");
        }
      }
    });

    wrapper.appendChild(hWidget);
    wrapper.appendChild(tBtn);
    wrapper.appendChild(gBtn);
  }

  function injectSendLeftGroup() {
    const sendBtn = findSendButton();
    if (!sendBtn || !sendBtn.parentNode) return;

    let wrapper = document.getElementById("crack-pure-send-left-group");

    if (!wrapper || !wrapper.isConnected) {
      wrapper = document.createElement("div");
      wrapper.id = "crack-pure-send-left-group";
      buildWrapperContents(wrapper);
      sendBtn.parentNode.insertBefore(wrapper, sendBtn);
    } else {
      // 내용물 유실 시에만 재생성
      if (
        !wrapper.querySelector("#crack-history-widget") ||
        !wrapper.querySelector("#crack-pure-magic-btn") ||
        !wrapper.querySelector("#crack-pure-trans-btn")
      ) {
        buildWrapperContents(wrapper);
      }

      // 위치가 틀어지면 전송 버튼 바로 앞으로만 복귀
      if (
        wrapper.parentNode !== sendBtn.parentNode ||
        wrapper.nextElementSibling !== sendBtn
      ) {
        sendBtn.parentNode.insertBefore(wrapper, sendBtn);
      }
    }

    // 전송 버튼: click listener만 1회 부착 (DOM 이동 금지)
    if (!sendBtn.dataset.crackResetHooked) {
      sendBtn.dataset.crackResetHooked = "true";
      sendBtn.addEventListener("click", () => resetHistory(), true);
    }

    // 입력창 Enter 전송 시 히스토리 초기화 (1회 훅)
    const chatInput = getChatInput();
    if (chatInput && !chatInput.dataset.historyHooked) {
      chatInput.dataset.historyHooked = "true";
      chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) resetHistory();
      });
    }
  }

  function isAllowedStoryChatPath() {
    return /^\/stories\/[^/]+\/episodes\/[^/]+(?:\/|$)/.test(location.pathname);
  }

  function cleanupInjectedUI() {
    const wrapper = document.getElementById("crack-pure-send-left-group");
    const settingsBtn = document.getElementById("crack-pure-settings-btn");
    const historyWidget = document.getElementById("crack-history-widget");
    const magicBtn = document.getElementById("crack-pure-magic-btn");
    const transBtn = document.getElementById("crack-pure-trans-btn");

    if (settingsBtn) settingsBtn.remove();
    if (historyWidget) historyWidget.remove();
    if (magicBtn) magicBtn.remove();
    if (transBtn) transBtn.remove();
    if (wrapper && wrapper.childElementCount === 0) wrapper.remove();

    generatedHistory = [];
    historyIndex = -1;
  }

  function injectUI() {
    // 사이드바 행/테마는 경로와 무관하게 유지 (설정 사이드바는 어디서든 열릴 수 있음)
    injectSidebarRow();
    applyCmwTheme();

    // 최소 route guard: /stories/*/episodes/* 에서만 채팅 버튼 주입.
    // SPA 이동으로 다른 화면에 남은 버튼은 즉시 정리한다.
    if (!isAllowedStoryChatPath()) {
      cleanupInjectedUI();
      currentRoomId = "";
      return;
    }

    const newRoomId = getChatRoomId();
    if (currentRoomId !== newRoomId) {
      currentRoomId = newRoomId;
      loadCfg();
    }

    // 1) ✍️ 설정 버튼: 모델 버튼 옆
    injectSettingsButton();

    // 2) 히스토리 + 🌐 번역 + ✨ 집필 버튼: 전송 버튼 좌측
    injectSendLeftGroup();
  }

  async function waitForLoreInjectorIfPresent() {
    const _w = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

    try {
      _w.addEventListener("LoreInj:ready", () => injectUI(), { once: true });
    } catch (e) {}

    const ready = _w.__LoreInjReady;
    if (!ready || typeof ready.then !== "function") return;

    const timeout = new Promise((resolve) => setTimeout(resolve, 2500));
    await Promise.race([Promise.resolve(ready).catch(() => null), timeout]);
  }

  async function boot() {
    // 1) DOM 준비 대기
    if (document.readyState === "loading") {
      await new Promise((resolve) =>
        document.addEventListener("DOMContentLoaded", resolve, { once: true }),
      );
    }

    // 2) React 렌더 직후 타이밍으로 넘기기 (rAF 2회)
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );

    // 3) 로어 인젝터가 있으면 선택적으로 대기. 없으면 즉시 진행
    await waitForLoreInjectorIfPresent();

    // 4) 최초 주입 + 가벼운 재확인 루프
    if (isAllowedStoryChatPath()) backgroundScanner();
    applyCmwTheme(true);
    injectUI();

    setInterval(() => {
      if (isAllowedStoryChatPath()) backgroundScanner();
      injectUI();
    }, 1000);
  }

  boot();
})();
