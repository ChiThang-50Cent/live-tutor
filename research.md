# Research & triển khai: English Speaking Tutor Live

**Ngày research:** 2026-10-13  
**Trạng thái:** Đề xuất technical spike, **chưa cần bật Google Cloud Billing / chưa cần nạp ₫150.000**  
**Mục tiêu chi phí v1:** **0₫**

---

## 1. Mục đích dự án

Xây một web app luyện nói tiếng Anh theo kiểu **live conversation**: người dùng nói trực tiếp bằng microphone, AI nghe và trả lời bằng giọng nói gần realtime, có thể bị ngắt lời tự nhiên, có transcript, và sau buổi học sinh một report ngắn để cải thiện speaking.

Mục đích của giai đoạn hiện tại **không phải** xây ngay một sản phẩm hoàn chỉnh. Mục đích là:

1. Chứng minh Gemini Live Free Tier đủ tốt về **latency, độ ổn định, session 20–30 phút, interruption và transcript**.
2. Chứng minh app có thể deploy với **Cloudflare Free** mà không relay audio qua backend.
3. Giữ chi phí bằng **0₫** cho tới khi đã có bằng chứng rõ rằng app hữu ích và Free Tier không đủ.
4. Tạo kiến trúc có thể nâng cấp lên multi-user sau này mà không phải viết lại audio pipeline.

### V1 phải làm được

- Start / End một buổi nói.
- Microphone stream liên tục.
- Gemini trả lời bằng voice.
- User nói chen thì AI dừng / chuyển lượt.
- Hiện transcript của user và AI.
- Tự reconnect khi Live API reset WebSocket.
- Một buổi 20–30 phút không cần thao tác reconnect thủ công.
- Sau khi End: report grammar, natural phrasing, vocabulary và focus cho buổi sau.
- Deploy trên `*.workers.dev`, chưa cần domain riêng.

### V1 chưa cần làm

- Pronunciation scoring theo phoneme kiểu ELSA.
- Lưu audio.
- Database cloud / sync đa thiết bị.
- Public signup.
- Subscription/payment.
- Dashboard phức tạp.
- Multi-user concurrency manager ngay từ đầu.

---

## 2. Kết luận research

**Dự án khả thi và nên thử bằng Free Tier trước.**

Stack đề xuất:

```text
React + TypeScript + Vite
        │
        ▼
Cloudflare Workers + Static Assets
        │
        ├── /api/token   -> mint Gemini ephemeral token
        └── /api/report  -> Gemini 3.8 Flash
        │
        ▼
Browser ─────────────────────── Gemini 3.8 Live
   🎤       WebSocket trực tiếp       🔊
```

Điểm quan trọng nhất: **audio không đi qua Cloudflare Worker**. Google thiết kế ephemeral token để client/browser kết nối trực tiếp tới Live API; backend chỉ mint token ngắn hạn. Điều này giảm latency và làm Worker cực nhẹ. [G3]

---

## 3. Những gì đã xác minh

### 3.1 Gemini 3.8 Live

`gemini-3.8-live` là model stable cho low-latency voice agent / real-time dialogue, có audio streaming native. [G1]

Pricing hiện tại:

- Free Tier input: **Free of charge**
- Free Tier output: **Free of charge**
- Free Tier content có thể được Google dùng để cải thiện sản phẩm. [G2]

AI Studio của project hiện tại đang hiển thị cho Gemini 3.8 Live:

```text
0 / Unlimited
0 / 150K
0 / Unlimited
```

Rate limit của Gemini thường được tính theo RPM, input TPM và RPD, và áp dụng **theo project chứ không theo API key**. Google cũng lưu ý quota hiển thị không phải SLA và capacity thực tế có thể thay đổi. [G7]

**Không suy ra 100 concurrent users chỉ từ 150K TPM.** Audio mới tích lũy khoảng 25 audio token/giây, nhưng history/context cũng ảnh hưởng token usage; concurrency thực tế phải benchmark. [G6]

### 3.2 Audio và hội thoại

Gemini Live nhận raw PCM:

- 16-bit PCM
- little-endian
- input native 16 kHz
- output 24 kHz

API có thể resample input, nhưng client nên resample xuống 16 kHz để tiết kiệm băng thông và giảm biến số. [G4]

Live API hỗ trợ:

- input audio transcription;
- output audio transcription;
- server-side VAD mặc định;
- interruption/barge-in: khi user bắt đầu nói lúc model đang nói, generation hiện tại bị cancel;
- hybrid VAD nếu muốn giảm delay cuối lượt. [G4]

### 3.3 Session 20–30 phút

Hai giới hạn khác nhau cần handle:

- WebSocket connection: khoảng **10 phút**.
- Audio-only session không compression: khoảng **15 phút**.

Giải pháp chính thức:

- `sessionResumption` để nối lại cùng logical session qua nhiều WebSocket;
- `contextWindowCompression` để session audio có thể kéo dài hơn giới hạn 15 phút;
- xử lý `GoAway` trước khi connection bị đóng. [G5]

Resumption token có hiệu lực 2 giờ sau khi session kết thúc. [G5]

### 3.4 Ephemeral token

Google khuyến nghị ephemeral token cho browser/mobile kết nối trực tiếp Live API. Flow:

```text
Browser -> backend
Backend -> Gemini auth token service
Backend -> Browser: short-lived token
Browser -> Gemini Live WebSocket trực tiếp
```

Token mặc định:

- 1 lần start new session;
- khoảng 1 phút để mở session mới;
- khoảng 30 phút `expireTime`.

Cùng token có thể dùng để **resume** connection trong thời gian hợp lệ ngay cả khi `uses: 1`. Có thể constrain token vào model và config. [G3]

**Risk:** ephemeral token vẫn đang ở trạng thái Preview tính tới 2026-10-13. [G3]

---

## 4. Cloudflare Free có đủ không?

Có, nếu Worker **không proxy audio**.

Workers Free hiện có:

- 100.000 Worker requests/ngày;
- 10 ms active CPU/request;
- 128 MB memory. [C1]

Cloudflare Static Assets:

- requests tới static assets: **free và unlimited**;
- không có thêm phí storage cho assets. [C2]

`workers.dev` có sẵn cho mỗi Worker và được Cloudflare định vị cho personal/hobby projects. Vì vậy MVP không cần mua domain hoặc động vào domain đang chạy app khác. [C3]

Cloudflare Access có thể protect trực tiếp Worker / `workers.dev`, nên app cá nhân có thể yêu cầu login trước khi truy cập. [C4]

---

## 5. Worker thực sự handle cái gì?

### V1

#### `POST /api/token`

Nhiệm vụ:

1. Kiểm tra request hợp lệ / đã qua Cloudflare Access.
2. Dùng `GEMINI_API_KEY` lưu trong Worker Secret.
3. Gọi Gemini auth token endpoint.
4. Mint ephemeral token:
   - `uses: 1`
   - constrain `gemini-3.8-live`
   - `responseModalities: ["AUDIO"]`
   - bật `sessionResumption`
   - bật config cần thiết
5. Trả token ngắn hạn về browser.

Worker kết thúc ở đây.

#### `POST /api/report`

Nhiệm vụ:

1. Nhận transcript cuối buổi.
2. Gọi `gemini-3.8-flash`.
3. Yêu cầu structured JSON report.
4. Trả JSON về browser.

### Không làm ở Worker

- Không stream microphone.
- Không resample audio.
- Không giữ Gemini WebSocket.
- Không phát audio.
- Không lưu audio.
- Không chạy speech-to-text riêng.

---

## 6. Ước lượng Worker usage

Một buổi 30 phút ở V1:

| Hành động | Dynamic Worker requests |
|---|---:|
| Load HTML/CSS/JS | 0 (Static Assets) |
| Mint ephemeral token | 1 |
| 30 phút audio | 0 |
| Session reconnect | 0 ở Worker nếu token vẫn hợp lệ |
| Generate report | 1 |
| **Tổng** | **~2** |

Quota Free là 100.000 Worker requests/ngày. [C1]

Với kiến trúc này, **Gemini quota sẽ là bottleneck trước Cloudflare rất lâu**.

---

## 7. Kiến trúc chi tiết

```text
┌─────────────────────────────────────────────┐
│ Browser                                     │
│                                             │
│ React UI                                    │
│  ├─ Start / Mute / End                      │
│  ├─ Transcript                              │
│  ├─ status / latency diagnostics            │
│  └─ session report                          │
│                                             │
│ Web Audio API                               │
│  ├─ getUserMedia                            │
│  ├─ AudioWorklet                            │
│  ├─ PCM16 / 16kHz encoder                   │
│  └─ 24kHz playback queue                    │
└───────────────┬─────────────────────────────┘
                │
        1. POST /api/token
                │
                ▼
┌─────────────────────────────────────────────┐
│ Cloudflare Worker                           │
│                                             │
│ Secret: GEMINI_API_KEY                      │
│                                             │
│ /api/token  ──> Gemini auth token service   │
│ /api/report ──> Gemini 3.8 Flash            │
└─────────────────────────────────────────────┘

Sau khi có ephemeral token:

Browser ═══════════ WebSocket ═══════════ Gemini 3.8 Live
  mic PCM16  ─────────────────────────────>
  <───────────────────────────── PCM24 voice
  <──────────────────────── input/output transcripts
```

---

## 8. Frontend audio pipeline

### Input

```text
getUserMedia()
     │
     ▼
AudioContext
     │
     ▼
AudioWorklet
     │
     ├─ mono
     ├─ resample -> 16 kHz
     ├─ Float32 -> Int16 PCM
     └─ chunk 20–100 ms
     │
     ▼
Gemini Live session.sendRealtimeInput()
```

Google khuyến nghị chunk nhỏ khoảng 20–100 ms để giảm latency. [G6]

Mic constraints nên thử:

```js
{
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
}
```

### Output

```text
Gemini audio chunk (24 kHz PCM)
       │
       ▼
decode Int16
       │
       ▼
Web Audio playback queue
       │
       ▼
speaker
```

Khi nhận event `interrupted`, phải **clear playback queue ngay**, nếu không UI sẽ vẫn phát phần audio cũ dù server đã cancel generation. [G4]

---

## 9. Live session config đề xuất

Pseudo-config:

```ts
const liveConfig = {
  responseModalities: ["AUDIO"],

  inputAudioTranscription: {},
  outputAudioTranscription: {},

  sessionResumption: {},

  contextWindowCompression: {
    slidingWindow: {}
  },

  realtimeInputConfig: {
    automaticActivityDetection: {
      disabled: false
    }
  }
};
```

V1 nên bắt đầu với server VAD mặc định. Sau khi đo latency thực tế mới thử hybrid VAD.

### Tutor behavior

System instruction mục tiêu:

```text
You are a conversational English speaking coach.

Primary goal:
Keep the learner speaking as much as possible in natural English conversation.

Behavior:
- Speak naturally but keep your turns short.
- Aim for the learner to speak about 65–75% of the session.
- Ask one clear follow-up question at a time.
- Do not interrupt the flow to correct every mistake.
- Correct only when misunderstanding would occur, or when the learner asks.
- Prefer natural everyday and workplace English.
- If the learner gets stuck, give a short hint instead of answering for them.
- Do not lecture.
- Do not produce a session report during the live conversation.
```

Correction/report sẽ xử lý sau buổi học.

---

## 10. Session report

Dùng `gemini-3.8-flash` với transcript, **không cần gửi audio lại**.

JSON mong muốn:

```json
{
  "summary": "Short assessment",
  "strengths": [
    "..."
  ],
  "corrections": [
    {
      "original": "...",
      "better": "...",
      "reason": "..."
    }
  ],
  "natural_phrases": [
    {
      "instead_of": "...",
      "try": "..."
    }
  ],
  "repeated_patterns": [
    "..."
  ],
  "vocabulary": [
    "..."
  ],
  "next_session_focus": "..."
}
```

### Không nên claim ở V1

Không ghi kiểu:

```text
Pronunciation score: 87/100
```

nếu chỉ dựa vào transcript. Phoneme-level pronunciation scoring là bài toán riêng.

---

## 11. Storage

### V1

Không database cloud.

Lưu local bằng IndexedDB:

```text
session_id
started_at
duration
user_transcript
assistant_transcript
report
diagnostics
```

Không lưu audio.

### Sau này

Chỉ thêm Cloudflare D1 khi cần:

- sync laptop/phone;
- account history;
- multi-user.

---

## 12. Security

### Bắt buộc

1. API key dài hạn chỉ nằm trong `wrangler secret`, không bundle frontend.
2. Browser chỉ nhận ephemeral token ngắn hạn.
3. Token constrain vào `gemini-3.8-live` + allowed Live config nếu API cho phép.
4. `/api/token` chỉ `POST`.
5. Protect Worker bằng Cloudflare Access trong giai đoạn personal.
6. Không log API key hoặc ephemeral token.
7. Không lưu audio.

### CSP cần lưu ý

Frontend sẽ mở WebSocket trực tiếp tới Gemini, vì vậy Content Security Policy phải cho `connect-src` tới endpoint Gemini tương ứng.

### Privacy

Free Tier hiện ghi rõ content **có thể được Google dùng để improve products**. [G2]

Do đó V1:

- phù hợp để luyện English cá nhân;
- **không nên đọc dữ liệu công việc mật, credentials, customer data hoặc tài liệu nội bộ nhạy cảm vào session Free Tier**.

Nếu sau này cần privacy cao hơn, xem xét Paid Tier vì pricing docs hiện ghi paid content không được dùng để improve products. [G2]

---

## 13. Domain & deploy

### V1

Dùng:

```text
english-tutor.<cloudflare-subdomain>.workers.dev
```

Không cần custom domain. Không đụng app hiện tại trên domain đang sử dụng.

### Sau khi app ổn

Có thể thêm:

```text
speak.example.com
```

mà root domain vẫn trỏ app cũ.

---

## 14. Cloudflare project config đề xuất

Một Worker chứa cả API và static assets.

`wrangler.jsonc` mẫu:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "english-speaking-tutor",
  "main": "./worker/index.ts",
  "compatibility_date": "2026-10-13",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application",
    "binding": "ASSETS",
    "run_worker_first": ["/api/*"]
  }
}
```

Cloudflare hỗ trợ selective `run_worker_first` cho `/api/*`, trong khi static assets được serve trực tiếp. [C5]

Secret:

```bash
npx wrangler secret put GEMINI_API_KEY
```

### Repo structure

```text
english-speaking-tutor/
├─ src/
│  ├─ app/
│  ├─ audio/
│  │  ├─ capture.ts
│  │  ├─ pcm-worklet.ts
│  │  └─ player.ts
│  ├─ gemini/
│  │  ├─ live-session.ts
│  │  └─ reconnect.ts
│  └─ report/
├─ worker/
│  ├─ index.ts
│  ├─ token.ts
│  └─ report.ts
├─ public/
├─ wrangler.jsonc
├─ vite.config.ts
└─ package.json
```

---

## 15. Concurrency strategy

### Personal MVP

```text
MAX_CONCURRENT = 1
```

Không cần Durable Object.

### Khi cho thêm user

Gemini quota áp dụng theo project, không theo API key. [G7]

Không được lấy:

```text
150K TPM / 1.5K audio token per min ≈ 100
```

rồi kết luận 100 concurrent sessions. Đây chỉ là upper bound ngây thơ cho **raw new audio**, chưa tính compounding context, model capacity và các giới hạn thực tế.

### Load test

Tăng dần:

```text
1 concurrent
3 concurrent
5 concurrent
10 concurrent
```

Đo:

- 429 rate;
- WebSocket disconnect;
- first-response latency;
- interruption latency;
- token/min;
- transcript lag;
- session-resume success.

### Nếu cần admission control

Thêm Durable Object:

```text
Worker
  │
  ▼
Durable Object: gemini-slots
  ├─ active leases
  ├─ MAX_CONCURRENT
  └─ expiry
```

Lease model:

```text
lease TTL: 90 s
heartbeat: 30 s
```

Browser chết thì slot tự expire.

Không implement phần này trước khi personal MVP chạy ổn.

---

## 16. Kế hoạch technical spike

### Phase 0 — Không billing

Điều kiện:

- Gemini project vẫn Free Tier.
- Không link paid billing.
- Không nạp ₫150.000.

### Phase 1 — Local voice loop

Mục tiêu:

```text
Start -> mic -> Gemini -> speaker
```

Checklist:

- [ ] Lấy API key Free Tier.
- [ ] Mic capture.
- [ ] PCM 16 kHz.
- [ ] Live WebSocket.
- [ ] Audio playback.
- [ ] Interruption.
- [ ] Input transcript.
- [ ] Output transcript.

### Phase 2 — Session reliability

- [ ] `sessionResumption`.
- [ ] `contextWindowCompression`.
- [ ] handle `GoAway`.
- [ ] auto-reconnect.
- [ ] test 20 phút.
- [ ] test 30 phút.

### Phase 3 — Cloudflare Free

- [ ] React/Vite build.
- [ ] Static Assets.
- [ ] Worker `/api/token`.
- [ ] Worker secret.
- [ ] `workers.dev`.
- [ ] Cloudflare Access.
- [ ] test desktop.
- [ ] test phone Wi-Fi.
- [ ] test phone 4G/5G.

### Phase 4 — Tutor UX

- [ ] tutor system prompt.
- [ ] speaking timer.
- [ ] user/AI talking indicator.
- [ ] transcript UI.
- [ ] End Session.
- [ ] `/api/report`.
- [ ] IndexedDB history.

### Phase 5 — Multi-user chỉ khi cần

- [ ] concurrency benchmark.
- [ ] Durable Object leases.
- [ ] rate limit `/api/token`.
- [ ] user identity/history.

---

## 17. Acceptance criteria trước khi đầu tư tiền

**Không bật Paid Tier nếu chưa pass các tiêu chí sau.**

### Must pass

- [ ] 3 buổi liên tiếp ≥ 20 phút không fatal error.
- [ ] Ít nhất 1 buổi 30 phút có reconnect tự động.
- [ ] User interrupt AI hoạt động tự nhiên.
- [ ] Transcript đủ dùng để làm feedback.
- [ ] Latency đủ thấp để cảm giác là conversation, không giống push-to-talk chậm.
- [ ] Chạy được trên browser desktop chính.
- [ ] Chạy được trên ít nhất một mobile browser thực tế.
- [ ] Deploy Cloudflare Free ổn.
- [ ] Không lộ Gemini API key xuống client.
- [ ] Không bị 429 thường xuyên ở usage cá nhân.

### Go / No-Go

**GO** nếu trải nghiệm speaking tốt và Free Tier đủ cho usage thật.

**NO-GO hoặc redesign** nếu:

- reconnect gây gián đoạn lớn;
- mobile audio quá lỗi;
- latency làm mất cảm giác hội thoại;
- Free Tier throttling thường xuyên;
- Gemini transcript không đủ tốt cho feedback.

---

## 18. Khi nào mới cân nhắc nạp ₫150.000?

Chỉ quay lại Paid Tier nếu ít nhất một trong các điều sau xảy ra:

1. App đã dùng thật thường xuyên và có giá trị.
2. Free Tier rate limit/capacity là bottleneck đã đo được.
3. Cần privacy của Paid Tier.
4. Cần nhiều concurrent users.
5. Muốn tận dụng Google Developer Program Cloud credits.

Khoản nạp Prepay / Google Cloud credits **không phải prerequisite của technical spike**.

---

## 19. Các rủi ro cần theo dõi

| Risk | Mức | Cách xử lý |
|---|---|---|
| Ephemeral token vẫn Preview | Medium | Isolate token code, dễ thay auth flow |
| Free quota/capacity thay đổi | Medium | Re-check AI Studio trước release |
| 10 phút/WebSocket | Known | Session resumption + GoAway handling |
| 15 phút session không compression | Known | Context compression |
| Mobile browser audio quirks | Medium | Test device thật sớm |
| Feedback pronunciation quá tự tin | Medium | Không chấm phoneme ở V1 |
| Free Tier privacy | High nếu dùng work data | Không gửi dữ liệu nhạy cảm |
| Concurrent capacity không có SLA | Medium | Admission control + benchmark |
| Model/API change | Medium | Centralize model ID/config |

---

## 20. Câu hỏi cần research trong lúc implement

1. Ephemeral token `expireTime` tối đa hiện tại là bao nhiêu và cấu hình nào phù hợp nhất cho target session 30 phút?
2. Gemini JS SDK trên browser xử lý session resumption ổn tới đâu so với raw WebSocket?
3. Actual input TPM của một session 30 phút với compression là bao nhiêu?
4. First-audio latency thực tế từ Việt Nam trên Wi‑Fi và 4G/5G?
5. Server VAD mặc định vs hybrid VAD: cái nào hợp learner hay pause suy nghĩ?
6. Mobile Safari/Chrome backgrounding có làm WebSocket/mic session chết không?
7. Nếu Access bảo vệ toàn Worker, UX login trên mobile có ổn không?
8. Có cần fallback khi report model bị 429, ví dụ lưu transcript và retry sau?
9. Report có cần structured output schema cứng hay parse JSON mềm là đủ?
10. Chất lượng English tutor có tốt hơn khi model nói tối đa 1–2 câu/lượt hay không?

---

## 21. Decision log

### Đã chốt cho spike

- **LLM voice:** `gemini-3.8-live`
- **Report:** `gemini-3.8-flash`
- **Hosting:** Cloudflare Workers + Static Assets
- **URL:** `workers.dev`
- **Auth app:** Cloudflare Access
- **Gemini auth:** ephemeral token
- **Audio path:** Browser ↔ Gemini trực tiếp
- **Storage:** IndexedDB
- **Billing:** Free Tier
- **Database:** không có
- **Concurrency:** 1 user
- **Audio recording:** không lưu

### Chưa chốt

- voice persona;
- hybrid VAD;
- custom domain;
- D1;
- Durable Object;
- paid tier.

---

## 22. Official references

### Google Gemini

- **[G1] Gemini 3.8 Live model:**  
  https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live

- **[G2] Gemini API pricing / Free Tier:**  
  https://ai.google.dev/gemini-api/docs/pricing

- **[G3] Live API ephemeral tokens:**  
  https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens

- **[G4] Live API capabilities — audio, transcription, VAD, interruption:**  
  https://ai.google.dev/gemini-api/docs/live-api/capabilities

- **[G5] Live API session management — 10-min connection, compression, resumption:**  
  https://ai.google.dev/gemini-api/docs/live-api/session-management

- **[G6] Live API best practices:**  
  https://ai.google.dev/gemini-api/docs/live-api/best-practices

- **[G7] Gemini API rate limits:**  
  https://ai.google.dev/gemini-api/docs/rate-limits

- **Gemini models list:**  
  https://ai.google.dev/gemini-api/docs/models

### Cloudflare

- **[C1] Workers platform limits:**  
  https://developers.cloudflare.com/workers/platform/limits/

- **[C2] Static Assets billing and limitations:**  
  https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/

- **[C3] `workers.dev`:**  
  https://developers.cloudflare.com/workers/configuration/routing/workers-dev/

- **[C4] Cloudflare Access for Workers:**  
  https://developers.cloudflare.com/workers/configuration/cloudflare-access/

- **[C5] Static Assets configuration / selective `/api/*` routing:**  
  https://developers.cloudflare.com/workers/static-assets/binding/

---

## 23. Recommendation cuối

**Không nạp tiền lúc này.**

Bước tiếp theo hợp lý nhất là một technical spike **zero-cost** với đúng kiến trúc production-like:

```text
Cloudflare Worker
   └─ mint ephemeral token

Browser
   └─ Gemini 3.8 Live trực tiếp
```

Nếu spike vượt qua bài test 20–30 phút, reconnect, mobile và latency, lúc đó mới đầu tư vào UI, history, multi-user hoặc Paid Tier.
