const {ipcMain, app, shell} = require('electron');
const {PreferencesManager} = require('../packages/arc-preferences/main');
const {ArcMainMenu} = require('./main-menu');
const {AppMenuService} = require('./app-menu-service');
const {DriveExport} = require('@advanced-rest-client/electron-drive');
const {SessionManager} = require('@advanced-rest-client/electron-session-state/main');
const {ContentSearchService} = require('../packages/search-service/main');
const {ArcWindowsManager} = require('./windows-manager');
const {UpdateStatus} = require('./update-status');
const {AppPrompts} = require('./app-prompts');
const {Oauth2Identity} = require('@advanced-rest-client/electron-oauth2');
const {ThemesProtocolHandler} = require('./theme-protocol');
const {ComponentsProtocolHandler} = require('./components-protocol');
const log = require('./logger');

class ArcEnvironment {
  constructor(params = {}) {
    this.isDebug = params.isDebug || false;
    this._initializeConfiguration(params);
    this._initializeWindowsManager(params);
    this._initializeMenu();
    this._initializeUpdateStatus();
    this._initializeGoogleDriveIntegration();
    this._initializeSessionManager();
    this._initializeApplicationMenu();
    this._initializeAppPrompts();

    Oauth2Identity.listen();

    // Remote commands protocol
    if (params.port) {
      this._initializeCommunicationProtocol(params.port);
    }

    // The most general events
    ipcMain.on('open-external-url', this._externalUrlHandler.bind(this));
  }

  loadEnvironment() {
    log.debug('Loading user configuration.');
    return this.config.load()
    .then((settings) => {
      log.debug('User configuration ready.');
      this._postConfig(settings);
    });
  }

  registerHandlers() {
    log.debug('Initializing themes protocol');
    const tp = new ThemesProtocolHandler();
    tp.register();
    this.themesProtocol = tp;
    const cp = new ComponentsProtocolHandler();
    cp.register();
    this.componentsProtocol = cp;
  }

  open(path) {
    this.wm.open(path);
  }

  _postConfig(config) {
    if (config.popupMenuExperimentEnabled) {
      log.info('Enabling menu popup experiment.');
      this.menu.enableAppMenuPopup();
    }
    if (!this.isDebug) {
      this.us.start(config);
    }
  }

  _initializeConfiguration(params) {
    this.config = new PreferencesManager(params);
    this.config.on('settings-changed', (name, value) => {
      this.wm.notifyAll('app-preference-updated', [name, value]);
      this._settingsChanged(name, value);
    });
    this.config.observe();
  }

  _initializeCommunicationProtocol(port) {
    if (isNaN(port)) {
      log.warn('The port ' + port + ' is not a number. Skipping.');
      return;
    }
    port = Number(port);
    const {CommunicationProtocol} = require('../packages/communication-protocol/main');
    this.comm = new CommunicationProtocol(port);
    this.comm.start();
  }

  _initializeMenu() {
    log.debug('Initializing application menu (system menu).');
    this.menu = new ArcMainMenu();
    this.menu.build();
    log.debug('Listening for system menu events.');
    this.menu.on('menu-action', (action, win) => {
      ContentSearchService.searchRequested(action, win);
      this.us.menuActionHandler(action, win);
      this._menuHandler(action, win);
    });
  }

  _initializeApplicationMenu() {
    log.debug('Initializing app menu service (popup listener).');
    const instance = new AppMenuService(this);
    instance.listen();
    this.appMenuService = instance;
  }

  _initializeGoogleDriveIntegration() {
    log.debug('Initializing Google Drive integration.');
    this.gdrive = new DriveExport();
    this.gdrive.listen();
  }

  _initializeSessionManager() {
    log.debug('Initializing session manager.');
    this.sm = new SessionManager({appUrls: [
      'https://advancedrestclient-1155.appspot.com',
      'advancedrestclient.com'
    ]});
    this.sm.listen();
    this.sm.on('cookie-changed', (cookies) =>
      this.wm.notifyAll('cookie-changed', [cookies]));
  }

  _initializeWindowsManager(params) {
    log.debug('Initializing windows manager.');
    this.wm = new ArcWindowsManager(params);
    this.wm.listen();
  }

  _initializeUpdateStatus() {
    log.info('Initializing update manager.');
    this.us = new UpdateStatus();
    this.us.listen();
    this.us.on('status-changed', (type) => {
      this.menu.updateStatusChnaged(type);
    });
    this.us.on('notify-windows', (type, arg) => {
      this.wm.notifyAll(type, arg);
    });
  }

  _initializeAppPrompts() {
    this.prompts = new AppPrompts();
    this.prompts.listen();
  }

  /**
   * Handler for settings change.
   * @param {String} name Changed property name
   * @param {any} value Changed value
   */
  _settingsChanged(name, value) {
    switch (name) {
      case 'popupMenuExperimentEnabled':
        if (this.menu) {
          if (value) {
            this.menu.enableAppMenuPopup();
          } else {
            this.menu.disableAppMenuPopup();
          }
        }
        break;
      case 'releaseChannel':
        this.us.updateReleaseChannel(value);
        break;
    }
  }

  /**
   * Event handler for menu actions.
   *
   * @param {String} action Action type to perform
   * @param {BrowserWindow} win
   */
  _menuHandler(action, win) {
    log.debug('Handing menu command: ' + action);
    if (action.indexOf('application') === 0) {
      this._handleApplicationAction(action.substr(12), win);
      return;
    }
    if (action.indexOf('request') === 0) {
      win.webContents.send('request-action', action.substr(8));
      return;
    }
    log.warn('Menu command not handled: ' + action);
  }
  /**
   * Handles `application` group of commands
   *
   * @param {String} action Application action.
   * @param {BrowserWindow} win Target window.
   */
  _handleApplicationAction(action, win) {
    let windowCommand = 'command';
    switch (action) {
      case 'quit':
        log.debug('Quiting the app.');
        app.quit();
        break;
      case 'new-window':
        log.debug('Opening new window.');
        this.wm.open();
        break;
      case 'task-manager':
        log.debug('Opening task manager.');
        this.wm.openTaskManager();
        break;
      case 'open-privacy-policy':
      case 'open-documentation':
      case 'open-faq':
      case 'open-discussions':
      case 'report-issue':
      case 'search-issues':
      case 'web-session-help':
        log.debug('Running help action.');
        let {HelpManager} = require('./help-manager');
        HelpManager.helpWith(action);
        break;
      case 'popup-menu':
        log.debug('Toggling popup menu.');
        this.appMenuService.togglePopupMenu();
        break;
      default:
        log.debug('Sending action to the UI thred.', action);
        win.webContents.send(windowCommand, action);
    }
  }

  /**
   * Handles opening an URL in a browser action.
   * @param {Event} e
   * @param {String} url The URL to open.
   */
  _externalUrlHandler(e, url) {
    if (!url) {
      return;
    }
    log.debug('Opening external URL: ' + url);
    shell.openExternal(url);
  }
}
module.exports.ArcEnvironment = ArcEnvironment;
