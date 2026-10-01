export const Header = () => `
<!-- ══════════ NAV ══════════ -->
<nav>
  <div class="nav-logo">Ur<em>Life</em></div>
  <div class="nav-links">
    <a href="#how" data-en="How It Works" data-ar="كيف يعمل">How It Works</a>
    <a href="#roles" data-en="Who It's For" data-ar="من هو لهم">Who It's For</a>
    <a href="#meeting" data-en="Closed Meeting" data-ar="الاجتماع المغلق">Closed Meeting</a>
    <a href="#revenue" data-en="Revenue Model" data-ar="نموذج الربح">Revenue Model</a>
    <a href="#roadmap" data-en="Roadmap" data-ar="خارطة الطريق">Roadmap</a>
  </div>
  <div class="nav-right">
    <button class="lang-btn" id="langToggle" onclick="toggleLang()">🌐 العربية</button>
    <button class="nav-cta" data-en="Request a Meeting" data-ar="اطلب اجتماعاً">Request a Meeting</button>
  </div>
</nav>
`;
