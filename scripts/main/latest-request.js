const path = require('path');
const {ArcPreferences} = require('./arc-preferences');
/**
 * A module responsible for storing / restoring latest request from user FS.
 */
class LatestRequest extends ArcPreferences {
  constructor() {
    super();
    this._file = path.join(this.userSettingsDir, 'latest.json');
  }

  restore() {
    return this.restoreFile(this._file);
  }

  store(data) {
    return this.storeFile(this._file, data);
  }
}
exports.LatestRequest = LatestRequest;