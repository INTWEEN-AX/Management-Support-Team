/**
 * BidBrief.gs — 공고 첨부(과업지시서/제안요청서)에서 본문 텍스트를 뽑아낸다
 *
 * 공고명만으로는 실제 과업 내용이 매칭에 반영되지 않는다.
 * 예) '2026년 스포츠사회적기업 비즈니스 컨퍼런스 운영 용역' 이라는 제목에는
 *     IR 피칭 · 네트워킹 · 전문가 섭외 · 부스 제작 같은 실제 과업이 안 들어 있다.
 *     그건 과업지시서 본문에 있고, 우리 실적과 진짜로 겹치는 건 그쪽이다.
 *
 * 추출 경로:
 *   PDF   → Drive 로 업로드하며 구글 문서로 변환(OCR) → 텍스트 → 임시문서 삭제
 *   HWPX  → ZIP 풀어서 Contents/section*.xml 의 <hp:t> 수집
 *   HWP   → 불가 (바이너리). 같은 공고에 PDF 가 함께 오면 그쪽을 쓴다.
 *
 * 한 번 뽑은 본문은 공고 폴더에 '_본문.txt' 로 저장해 재사용한다.
 * (OCR 변환은 느리고 할당량을 쓰므로 매번 돌리지 않는다)
 */

var BRIEF_CACHE_NAME = '_본문.txt';
var BRIEF_MAX_CHARS = 20000;
var BRIEF_MAX_FILES = 2;
var BRIEF_MAX_BYTES = 12 * 1024 * 1024;   // 이보다 큰 첨부는 건너뛴다

/** 과업 내용이 담겼을 법한 파일명 — 앞에 있을수록 우선 */
var BRIEF_PREFERRED = [
  '과업지시서', '과업내용서', '제안요청서', '과업설명서', '사업설명서',
  '입찰설명서', '규격서', 'rfp', '과업'
];

/** 본문으로 쓰면 안 되는 파일 (계약예규·서약서 등 어느 공고에나 붙는 것) */
var BRIEF_EXCLUDED = [
  '계약예규', '유의서', '일반조건', '특수조건', '청렴', '서약서',
  '유의사항', '참가자격', '등록증', '위임장'
];

// ─────────────────────────────────────────────────────────────
// 공개 진입점
// ─────────────────────────────────────────────────────────────

/**
 * 공고문 본문까지 반영한 실적 매칭.
 * 첨부가 없거나 추출에 실패하면 공고명 기준 결과로 물러선다.
 */
function getBidBriefMatches(bidNo, bidOrd) {
  var bids = getBidData();
  var key = String(bidNo || '').trim();
  var ord = String(bidOrd == null ? '' : bidOrd).trim();

  var bid = null;
  for (var i = 0; i < bids.length; i++) {
    if (String(bids[i].no).trim() !== key) continue;
    if (ord && String(bids[i].ord).trim() !== ord) continue;
    bid = bids[i];
    break;
  }
  if (!bid) throw new Error('공고를 찾지 못했습니다: ' + key);

  var brief = extractBidBrief_(bid);
  var query = [bid.name, bid.demandOrg, bid.noticeOrg, brief.text]
    .filter(Boolean).join(' ');

  var matches = matchPerformance_({
    name: query,
    demandOrg: bid.demandOrg,
    noticeOrg: bid.noticeOrg
  });
  addBriefContexts_(matches, brief.text);

  return JSON.parse(JSON.stringify({
    bid: bid,
    brief: {
      source: brief.source,
      chars: brief.text.length,
      note: brief.note,
      text: brief.text          // 화면에서 공고문 원문을 보여주기 위해 함께 넘긴다
    },
    matches: matches
  }));
}

/**
 * 화면에서 [분석 실행] 을 눌렀을 때 도는 한 방 호출.
 *
 * 실적은 공고명(제목)만으로 매칭하므로 공고문이 없어도 나온다.
 * 공고문은 참여인력의 '요구 경력' 을 읽기 위해서만 쓴다.
 * 읽을 수 있는 첨부가 없으면 공고문 없이 진행하고 그 사실을 알린다.
 */
function runProposeAnalysis(bidNo, bidOrd) {
  var result = getBidMatches(bidNo, bidOrd);   // { bid, field, matches }
  var briefText = '', briefInfo = null, briefError = '';

  try {
    var bid = findBidRecord_(bidNo, bidOrd);
    var brief = extractBidBrief_(bid);
    briefText = brief.text;
    briefInfo = { source: brief.source, chars: brief.text.length, text: brief.text };
  } catch (e) {
    briefError = String(e.message || e).split('\n')[0];
  }

  var hr = recommendPeople(briefText);

  return JSON.parse(JSON.stringify({
    bid: result.bid,
    field: result.field,
    matches: result.matches,
    brief: briefInfo,
    briefError: briefError,
    requirement: hr.requirement,
    people: hr.people
  }));
}

/** 캐시(_본문.txt)를 버리고 다시 추출한다 — hwpx 를 새로 올린 뒤 쓴다 */
function refreshBidBrief(bidNo, bidOrd) {
  var bids = getBidData();
  var no = String(bidNo || '').trim();
  var bid = null;
  for (var i = 0; i < bids.length; i++) {
    if (String(bids[i].no).trim() === no) { bid = bids[i]; break; }
  }
  if (!bid) throw new Error('공고를 찾지 못했습니다: ' + no);

  try {
    var parent = getBidAttachFolder_();
    var it = parent.getFoldersByName(bidFolderName_(bid));
    if (it.hasNext()) {
      var cached = it.next().getFilesByName(BRIEF_CACHE_NAME);
      while (cached.hasNext()) cached.next().setTrashed(true);
    }
  } catch (e) {
    Logger.log('본문 캐시 삭제 실패(무시): ' + e);
  }
  return getBidBriefMatches(bidNo, bidOrd);
}

/**
 * 각 실적이 공고문의 '어느 대목' 때문에 걸렸는지 문맥을 붙인다.
 * 근거 구절만 보여주면 왜 뽑혔는지 알기 어렵다 —
 * 공고문에서 그 말이 나온 문장을 함께 보여줘야 판단할 수 있다.
 */
function addBriefContexts_(matches, briefText) {
  if (!briefText) return;
  var lower = briefText.toLowerCase();

  matches.forEach(function (m) {
    var out = [];
    (m.hits || []).forEach(function (h) {
      if (out.length >= 2) return;
      var at = lower.indexOf(String(h).toLowerCase());
      if (at === -1) return;
      var from = Math.max(0, at - 45);
      var to = Math.min(briefText.length, at + h.length + 45);
      out.push({
        term: h,
        text: (from > 0 ? '…' : '') +
              briefText.slice(from, to).replace(/\s+/g, ' ').trim() +
              (to < briefText.length ? '…' : '')
      });
    });
    m.contexts = out;
  });
}

// ─────────────────────────────────────────────────────────────
// 첨부 목록 (화면에 뭐가 붙어 있는지 보여주기 위한 것)
// ─────────────────────────────────────────────────────────────

function isReadableExt_(ext) {
  return ext === 'pdf' || ext === 'hwpx';
}

function attachmentNote_(ext, excluded) {
  if (excluded) return '참고문서 (본문 대상 아님)';
  if (ext === 'hwpx') return '읽을 수 있음';
  if (ext === 'pdf') return '읽을 수 있음 (변환 필요)';
  if (ext === 'hwp') return 'hwpx 로 변환하면 읽을 수 있음';
  if (ext === 'zip') return '내려받아야 내용 확인';
  return ext ? ext + ' 파일' : '알 수 없음';
}

function isExcludedBriefName_(lowerName) {
  return BRIEF_EXCLUDED.some(function (w) { return lowerName.indexOf(w) > -1; });
}

/**
 * 공고에 어떤 첨부가 붙어 있는지 돌려준다. (내려받지 않고 목록만)
 * 이미 내려받아 둔 폴더가 있으면 그 안의 파일까지 합쳐서 보여준다 —
 * 사용자가 hwp 를 hwpx 로 변환해 넣어둔 경우를 알아보기 위해서다.
 */
function getBidAttachmentInfo(bidNo, bidOrd) {
  var no = String(bidNo || '').trim();
  var out = { files: [], folderUrl: '', downloaded: false, hasReadable: false, error: '' };

  try {
    var items = fetchBidByNo_(no);
    if (items.length) {
      extractSpecDocs_(items[0]).forEach(function (d) {
        var lower = String(d.name).toLowerCase();
        var ext = lower.replace(/^.*\./, '');
        out.files.push({
          name: d.name,
          ext: ext,
          where: 'remote',
          readable: isReadableExt_(ext),
          excluded: isExcludedBriefName_(lower),
          note: attachmentNote_(ext, isExcludedBriefName_(lower)),
          url: d.url
        });
      });
    }
  } catch (e) {
    out.error = String(e.message || e);
  }

  // 이미 받아둔 폴더가 있으면 그 안을 보여준다 (압축 해제분·사용자가 넣은 변환본 포함)
  try {
    var bids = getBidData();
    var bid = null;
    for (var i = 0; i < bids.length; i++) {
      if (String(bids[i].no).trim() === no) { bid = bids[i]; break; }
    }
    if (bid) {
      var parent = getBidAttachFolder_();
      var it = parent.getFoldersByName(bidFolderName_(bid));
      if (it.hasNext()) {
        var folder = it.next();
        out.downloaded = true;
        out.folderUrl = folder.getUrl();
        out.files = [];   // 로컬이 더 정확하므로 원격 목록을 대체한다

        rankAllFiles_(folder).forEach(function (f) {
          if (f.name === BRIEF_CACHE_NAME) return;
          var lower = f.name.toLowerCase();
          out.files.push({
            name: f.name,
            ext: f.ext,
            where: 'drive',
            readable: isReadableExt_(f.ext),
            excluded: isExcludedBriefName_(lower),
            note: attachmentNote_(f.ext, isExcludedBriefName_(lower)),
            url: f.file.getUrl()
          });
        });
      }
    }
  } catch (e) {
    if (!out.error) out.error = String(e.message || e);
  }

  out.hasReadable = out.files.some(function (f) { return f.readable && !f.excluded; });
  return JSON.parse(JSON.stringify(out));
}

/** 폴더(하위 포함)의 모든 파일을 {file, name, ext} 로 */
function rankAllFiles_(folder) {
  var files = [];
  (function collect(f) {
    var it = f.getFiles();
    while (it.hasNext()) files.push(it.next());
    var subs = f.getFolders();
    while (subs.hasNext()) collect(subs.next());
  })(folder);

  return files.map(function (file) {
    var name = file.getName();
    return { file: file, name: name, ext: name.toLowerCase().replace(/^.*\./, '') };
  }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
}

/** 화면에서 [첨부 내려받기] 를 눌렀을 때 */
function downloadBidAttachments(bidNo, bidOrd) {
  var bids = getBidData();
  var no = String(bidNo || '').trim();
  var bid = null;
  for (var i = 0; i < bids.length; i++) {
    if (String(bids[i].no).trim() === no) { bid = bids[i]; break; }
  }
  if (!bid) throw new Error('공고를 찾지 못했습니다: ' + no);

  getOrFetchBidFolder_(bid);
  return getBidAttachmentInfo(bidNo, bidOrd);
}

// ─────────────────────────────────────────────────────────────
// 본문 추출
// ─────────────────────────────────────────────────────────────

/** 공고 하나의 첨부 폴더 이름 (fetchBidAttachments 와 같은 규칙) */
function bidFolderName_(bid) {
  var safe = String(bid.name).replace(/[\\\/:*?"<>|]/g, '_').slice(0, 60);
  return bid.no + '_' + safe;
}

/** 이미 받아둔 폴더를 찾고, 없으면 첨부를 새로 내려받는다 */
function getOrFetchBidFolder_(bid) {
  var parent = getBidAttachFolder_();
  var wanted = bidFolderName_(bid);

  var it = parent.getFoldersByName(wanted);
  if (it.hasNext()) return it.next();

  // 아직 안 받았으면 지금 받는다
  var items = fetchBidByNo_(bid.no);
  if (!items.length) throw new Error('나라장터에서 공고를 찾지 못했습니다: ' + bid.no);

  var docs = extractSpecDocs_(items[0]);
  if (!docs.length) throw new Error('이 공고에는 첨부파일이 없습니다.');

  var folder = parent.createFolder(wanted);
  docs.forEach(function (d) {
    try {
      var resp = UrlFetchApp.fetch(d.url, { muteHttpExceptions: true, followRedirects: true });
      if (resp.getResponseCode() !== 200) return;
      var blob = resp.getBlob().setName(d.name);
      folder.createFile(blob);
      if (/\.zip$/i.test(d.name)) unzipInto_(blob, folder, d.name);
    } catch (e) {
      Logger.log('첨부 저장 실패: ' + d.name + ' — ' + e);
    }
  });
  return folder;
}

/** 폴더 안의 파일을 '본문일 가능성' 순으로 정렬 */
function rankBriefFiles_(folder) {
  var files = [];

  function collect(f) {
    var it = f.getFiles();
    while (it.hasNext()) files.push(it.next());
    var subs = f.getFolders();
    while (subs.hasNext()) collect(subs.next());
  }
  collect(folder);

  return files.map(function (file) {
      var name = file.getName();
      var lower = name.toLowerCase();
      var ext = lower.replace(/^.*\./, '');

      // 읽을 수 있는 형식만
      var readable = (ext === 'pdf' || ext === 'hwpx');
      var excluded = BRIEF_EXCLUDED.some(function (w) { return lower.indexOf(w) > -1; });

      var score = 0;
      BRIEF_PREFERRED.forEach(function (w, i) {
        if (lower.indexOf(w) > -1) score += (BRIEF_PREFERRED.length - i) * 10;
      });
      // hwpx 가 PDF 보다 정확하다 (OCR 을 거치지 않으므로)
      if (ext === 'hwpx') score += 5;

      return { file: file, name: name, ext: ext, score: score, ok: readable && !excluded };
    })
    .filter(function (f) { return f.ok; })
    .sort(function (a, b) { return b.score - a.score; });
}

/**
 * 공고 본문 텍스트를 얻는다.
 * 반환: { text, source, note }
 */
function extractBidBrief_(bid) {
  var folder = getOrFetchBidFolder_(bid);

  // 이미 뽑아둔 게 있으면 그대로 쓴다
  var cached = folder.getFilesByName(BRIEF_CACHE_NAME);
  if (cached.hasNext()) {
    var f = cached.next();
    return {
      text: f.getBlob().getDataAsString('UTF-8').slice(0, BRIEF_MAX_CHARS),
      source: '저장된 본문',
      note: '이전에 추출해 둔 ' + BRIEF_CACHE_NAME + ' 를 사용했습니다.'
    };
  }

  var candidates = rankBriefFiles_(folder);
  if (!candidates.length) {
    var hwpOnly = folder.getFilesByType('application/msword').hasNext();
    throw new Error(
      '읽을 수 있는 첨부가 없습니다.' +
      (hwpOnly ? '\n\n구형 .hwp 만 있습니다. 한컴에서 hwpx 나 PDF 로 저장해 같은 폴더에 올려주세요.' : ''));
  }

  var texts = [], used = [];
  for (var i = 0; i < candidates.length && used.length < BRIEF_MAX_FILES; i++) {
    var c = candidates[i];
    try {
      if (c.file.getSize() > BRIEF_MAX_BYTES) continue;
      var t = (c.ext === 'hwpx') ? hwpxToText_(c.file) : pdfToText_(c.file);
      if (t && t.trim().length > 200) {   // 표지만 읽힌 경우를 걸러낸다
        texts.push(t);
        used.push(c.name);
      }
    } catch (e) {
      Logger.log('본문 추출 실패: ' + c.name + ' — ' + e);
    }
  }

  if (!texts.length) throw new Error('첨부에서 본문을 읽어내지 못했습니다.');

  var merged = texts.join('\n').replace(/[ \t]+/g, ' ').slice(0, BRIEF_MAX_CHARS);
  folder.createFile(Utilities.newBlob(merged, 'text/plain', BRIEF_CACHE_NAME));

  return {
    text: merged,
    source: used.join(', '),
    note: used.length + '개 파일에서 ' + merged.length.toLocaleString() + '자를 추출했습니다.'
  };
}

// ─────────────────────────────────────────────────────────────
// 형식별 텍스트 추출
// ─────────────────────────────────────────────────────────────

/** hwpx → 본문 텍스트 (FormAnalyzer 와 같은 방식) */
function hwpxToText_(file) {
  var entries = Utilities.unzip(file.getBlob().setContentType('application/zip'));
  var out = [];
  entries.forEach(function (b) {
    if (!HWPX_SECTION_RE.test(b.getName())) return;
    var root = XmlService.parse(b.getDataAsString('UTF-8')).getRootElement();
    findDescendants_(root, 't').forEach(function (t) { out.push(t.getText()); });
  });
  return out.join(' ');
}

/**
 * PDF → 텍스트.
 * Drive 에 '구글 문서로 변환' 하며 올리면 Drive 가 텍스트를 뽑아준다.
 * 고급 서비스를 켤 필요 없이 REST 로 직접 호출한다 (DriveApp 권한을 그대로 씀).
 */
function pdfToText_(file) {
  var token = ScriptApp.getOAuthToken();
  var boundary = 'bd' + Utilities.getUuid().replace(/-/g, '');
  var metadata = {
    name: 'tmp_brief_' + Utilities.getUuid(),
    mimeType: 'application/vnd.google-apps.document'
  };

  var head = Utilities.newBlob(
    '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: application/pdf\r\n\r\n').getBytes();
  var tail = Utilities.newBlob('\r\n--' + boundary + '--').getBytes();
  var payload = head.concat(file.getBlob().getBytes()).concat(tail);

  var res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files' +
    '?uploadType=multipart&ocrLanguage=ko&supportsAllDrives=true',
    {
      method: 'post',
      contentType: 'multipart/related; boundary=' + boundary,
      payload: payload,
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });

  if (res.getResponseCode() !== 200) {
    throw new Error('PDF 변환 실패 HTTP ' + res.getResponseCode() + ' — ' +
                    res.getContentText().slice(0, 200));
  }

  var docId = JSON.parse(res.getContentText()).id;
  try {
    return DocumentApp.openById(docId).getBody().getText();
  } finally {
    try { DriveApp.getFileById(docId).setTrashed(true); } catch (e) { /* 무시 */ }
  }
}

// ─────────────────────────────────────────────────────────────
// 진단
// ─────────────────────────────────────────────────────────────

/** 메뉴: 공고문 본문 추출 시험 */
function testBidBrief() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt(
    '공고문 본문 추출 시험',
    '공고번호를 입력하세요.\n첨부를 아직 안 받았으면 자동으로 받아옵니다.',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var no = res.getResponseText().trim();
  if (!no) return;

  try {
    var out = getBidBriefMatches(no, '');
    var top = out.matches.slice(0, 5).map(function (m, i) {
      return (i + 1) + '. [' + m.scorePct + '%] ' + String(m.record.taskName).slice(0, 40) +
             '\n     근거: ' + (m.hits.join(', ') || '(없음)');
    });
    ui.alert(
      '공고문 본문 반영 결과\n\n' +
      '공고: ' + out.bid.name.slice(0, 50) + '\n' +
      '출처: ' + out.brief.source + '\n' +
      '분량: ' + out.brief.chars.toLocaleString() + '자\n\n' +
      '상위 5건\n' + top.join('\n'));
  } catch (e) {
    ui.alert('본문 추출 실패\n\n' + (e.message || e));
  }
}
