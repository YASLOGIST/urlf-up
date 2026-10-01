export const Dashboard = () => `
<!-- ══════════ NEXUS DASHBOARD ══════════ -->
<section id="nexus-dashboard" hidden>
  <div class="nx-container">
    <div class="nx-header">
      <div id="nx-title"></div>
      <div id="nx-user-role"></div>
      <button id="nexus-refresh" type="button">&#8635; Refresh</button>
    </div>
    
    <!-- AI-Recommended Matches Panel -->
    <div id="nx-ai-matches-panel" hidden>
      <h3 class="nx-matches-heading" style="margin-bottom: 16px;">AI-Recommended Matches</h3>
      <div id="nx-ai-matches-list" style="display:flex; gap:16px; flex-wrap:wrap;"></div>
    </div>

    <div id="nx-ideas-panel" hidden>
      <div id="nx-ideas-list"></div>
      <div id="nx-ideas-sentinel"></div>
    </div>
    <div id="nx-matches-panel" hidden>
      <div id="nx-matches-list"></div>
      <div id="nx-matches-sentinel"></div>
    </div>
    <div id="nx-skeleton" hidden></div>
    <div id="nx-empty"    hidden></div>
    <div id="nx-error"    hidden></div>
  </div>
</section>
`;
