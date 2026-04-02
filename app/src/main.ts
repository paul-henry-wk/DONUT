// ═══════════════════════════════════════════════════════════════════
// main.ts — Application entry point
// Imports all modules, assigns window aliases for onclick handlers,
// and bootstraps the application.
// ═══════════════════════════════════════════════════════════════════

import './types';
import './state';
// CSS is loaded from public/style.css via <link> in index.html (not imported here to avoid Vite duplicating font files)

// ── Module imports ──
import { toast } from './state';

import {
  getWorkflow, advanceWorkflow, recalcWorkflow, getRecommended,
  getScriptsForState, resetWorkflow, renderWorkflowBar, highlightWfStep,
  toggleWfHistory, confirmResetWorkflow,
} from './workflow';

import {
  appendLog, closeDiffBlock, scrollTermToBottom, clearTerm, copyTerm,
  exportTerm, filterTerm, setTypeFilter, toggleWordWrap, toggleRelativeTime,
  copyLine, setIndicator, showStopBtn, hideRerunBtn, showRerunBtn, reRunLast,
  startSpinner, stopSpinner, startRunTimer, stopRunTimer,
  expandTerminal, togglePanel, toggleFullscreen,
  expandAllDiff, collapseAllDiff, toggleMetadataBlocks, navigateDiffBlock,
  navigateErrors, startProgress, stopProgress,
  startPatienceMessages, stopPatienceMessages, showPRLink,
  openFilePath, setTermFontSize, addRunHistory, doStop,
} from './terminal';

import {
  renderScripts, selectScript, toggleFav, renderRunBar,
  doRun, showTab, validateEnvForScript, toggleWatch,
} from './scripts';

import {
  createNewEnv, cloneCurrentEnv, deleteCurrentEnv, renameCurrentEnv, renderConfig,
  toggleWizStep, filterPackages, selectAllPkgs, deselectAllPkgs, updatePkgCount,
  saveConfig, autoSave, handleDrop, ssOpen, ssFilter, ssSelect,
  onProjectChange, onRepoChange, wizValidatePat, refreshRepos, refreshBranches,
  togglePwd, onVersionChange, searchWI, showWIResults, showWIResultsCached,
  loadPackages, loadWorkItems, loadMyWorkItems,
  createBranch, deleteBranch, doBrowse, doBrowseFile, selectWI,
  getToken, getRepo, loadBranches, loadRepos, validatePath,
} from './config';

import { renderDevops, resetGitCreds, reassignWI, viewPrDiff } from './devops';

import { refreshHealth, toggleHealthPopup, autoFixHealth } from './health';

import {
  showModal, showConfirm, showPrompt, dropDonut, openUrl,
  setTheme, toggleThemeList, closeThemeList,
  loadEnv, init, setupEventListeners,
  installPrereq, installAllPrereqs,
  checkForUpdates, applyUpdate,
} from './app';

import { toggleDonutPet } from './donut-pet';
import { initGravityEgg } from './gravity-egg';

// ═══════════════════════════════════════════════════════════════════
// Window aliases for HTML inline onclick handlers
// ═══════════════════════════════════════════════════════════════════

// From scripts.ts
window.doRun = doRun;
window.toggleWatch = toggleWatch;
window.showTab = showTab;
window.selectScript = selectScript;
window.toggleFav = toggleFav;
window.renderScripts = renderScripts;
window.renderRunBar = renderRunBar;

// From terminal.ts
window.togglePanel = togglePanel;
window.toggleFullscreen = toggleFullscreen;
window.copyTerm = copyTerm;
window.clearTerm = clearTerm;
window.exportTerm = exportTerm;
window.filterTerm = filterTerm;
window.setTypeFilter = setTypeFilter;
window.toggleWordWrap = toggleWordWrap;
window.toggleRelativeTime = toggleRelativeTime;
window.copyLine = copyLine;
window.scrollTermToBottom = scrollTermToBottom;
window.reRunLast = reRunLast;
window.expandAllDiff = expandAllDiff;
window.collapseAllDiff = collapseAllDiff;
window.toggleMetadataBlocks = toggleMetadataBlocks;
window.navigateDiffBlock = navigateDiffBlock;
window.navigateErrors = navigateErrors;
window.doStop = doStop;

// From config.ts
window.loadEnv = loadEnv;
window.saveConfig = saveConfig;
window.autoSave = autoSave;
window.filterPackages = filterPackages;
window.selectAllPkgs = selectAllPkgs;
window.deselectAllPkgs = deselectAllPkgs;
window.updatePkgCount = updatePkgCount;
window.toggleWizStep = toggleWizStep;
window.renderConfig = renderConfig;
window.handleDrop = handleDrop;
window.ssOpen = ssOpen;
window.ssFilter = ssFilter;
window.ssSelect = ssSelect;
window.onProjectChange = onProjectChange;
window.onRepoChange = onRepoChange;
window.wizValidatePat = wizValidatePat;
window.refreshRepos = refreshRepos;
window.refreshBranches = refreshBranches;
window.togglePwd = togglePwd;
window.onVersionChange = onVersionChange;
window.searchWI = searchWI;
window.showWIResults = showWIResults;
window.showWIResultsCached = showWIResultsCached;
window.loadPackages = loadPackages;
window.createNewEnv = createNewEnv;
window.cloneCurrentEnv = cloneCurrentEnv;
window.deleteCurrentEnv = deleteCurrentEnv;
window.renameCurrentEnv = renameCurrentEnv;
window.createBranch = createBranch;
window.deleteBranch = deleteBranch;
window.doBrowse = doBrowse;
window.doBrowseFile = doBrowseFile;
window.validatePath = validatePath;
window.selectWI = selectWI;
window.loadWorkItems = loadWorkItems;
window.loadMyWorkItems = loadMyWorkItems;

// From app.ts
window.showModal = showModal;
window.showConfirm = showConfirm;
window.showPrompt = showPrompt;
window.openUrl = openUrl;
window.dropDonut = dropDonut;
window.toggleThemeList = toggleThemeList;
window.setTheme = setTheme;
window.closeThemeList = closeThemeList;
window.installPrereq = installPrereq;
window.installAllPrereqs = installAllPrereqs;
window.checkForUpdates = checkForUpdates;
window.applyUpdate = applyUpdate;

// From donut-pet.ts
window.toggleDonutPet = toggleDonutPet;

// From workflow.ts
window.resetWorkflow = resetWorkflow;
window.renderWorkflowBar = renderWorkflowBar;
window.confirmResetWorkflow = confirmResetWorkflow;
window.toggleWfHistory = toggleWfHistory;
window.highlightWfStep = highlightWfStep;

// From health.ts
window.refreshHealth = refreshHealth;
window.toggleHealthPopup = toggleHealthPopup;
window.autoFixHealth = autoFixHealth;

// From devops.ts
window.renderDevops = renderDevops;
window.resetGitCreds = resetGitCreds;
window.reassignWI = reassignWI;
window.viewPrDiff = viewPrDiff;

// Additional
window.openFilePath = openFilePath;
window.toast = toast;

// ═══════════════════════════════════════════════════════════════════
// Bootstrap
// ═══════════════════════════════════════════════════════════════════

// Set theme before rendering (prevents flash)
setTheme(localStorage.getItem('donut-theme') || 'light');

// Reveal body now that CSS and theme are loaded (prevents raw HTML flash)
document.body.classList.add('ready');

// Set up all event listeners
setupEventListeners();

// Easter eggs
initGravityEgg();

// Initialize the app
init().catch((e: unknown) => {
  console.error('init failed:', e);
  const o = document.getElementById('loadingOverlay');
  if (o) { o.classList.add('hidden'); setTimeout(() => o.remove(), 400); }
});
