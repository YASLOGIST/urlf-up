# DOM Sanitization Report — UrLfXUp
**Date:** 2026-05-20T03:25:51.376Z
```

═══════════════════════════════════════════
  DOM SANITIZATION REPORT — UrLfXUp
═══════════════════════════════════════════

  BEFORE:
    Total lines              : 10257
    File size                : 738.1 KB
    <style> blocks           : 3
    <script src=...> tags    : 43
    <html id="html-root">    : ×2
    #cur                     : ×5
    #cur-ring                : ×5
    #toast-container         : ×5
    #auth-modal              : ×5
    #idea-modal              : ×5
    #settings-modal          : ×5

  REMOVED:
    Duplicate document bodies: 1 (lines 2631–10257)
    Lines destroyed          : 7627
    Bloat eliminated         : 74.4%

  AFTER:
    Total lines              : 2630    (Δ: -7627)
    File size                : 150.0 KB  (Δ: -588.1 KB)
    <style> blocks           : 1   ✅
    <script src=...> tags    : 9   ✅
    <html id="html-root">    : ×1  ✅
    #cur                     : ×1   ✅
    #cur-ring                : ×1   ✅
    #toast-container         : ×1   ✅
    #auth-modal              : ×1   ✅
    #idea-modal              : ×1   ✅
    #settings-modal          : ×1   ✅
    Duplicate IDs            : 0   ✅
    HTML validation          : PASS ✅

  CANONICAL SURVIVORS:
    <html id="html-root">   — line 1
    <div id="cur">           — line 1891
    <div id="cur-ring">      — line 1892
    <div id="auth-modal">   — line 2356
    <div id="idea-modal">   — line 2421
    <dialog id="settings-modal"> — line 2456
    <div id="toast-container"> — line 2539

  BACKUP:
    index.html.bak.1779247551

═══════════════════════════════════════════

```
