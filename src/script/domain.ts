import WebConfig from './webConfig';

export default class Domain {
  advanced: boolean;
  audioWordlistId: number;
  cfg: DomainCfg;
  cfgKey: string;
  disabled: boolean;
  enabled: boolean;
  hostname?: string;
  tab?: any;
  wordlistId: number;

  static readonly _domainCfgDefaults: DomainCfg = {
    adv: undefined,
    audioList: undefined,
    disabled: undefined,
    enabled: undefined,
    wordlist: undefined,
  }

  static byHostname(hostname: string, domains: { [domain: string]: DomainCfg }): Domain {
    let cfgKey = Domain.findDomainKey(hostname, domains) || hostname;
    let domain = Domain.byKey(cfgKey, domains);
    domain.hostname = hostname;
    return domain;
  }

  static byKey(key: string, domains: { [domain: string]: DomainCfg }): Domain {
    return new Domain(key, domains[key]);
  }

  static findDomainKey(hostname: string, domains: { [domain: string]: DomainCfg }): string {
    let sorted = Object.keys(domains).sort((a, b) => { return b.length - a.length; });
    return sorted.find(key => new RegExp(`(^|.)${key}$`).test(hostname));
  }

  static getCurrentTab() {
    /* istanbul ignore next */
    return new Promise(function(resolve, reject) {
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        resolve(tabs[0]);
      });
    });
  }

  static sortedKeys(domains: { [site: string]: DomainCfg }) {
    return Object.keys(domains).sort(function(a,b) {
      let domainA = a.match(/\w*\.\w*$/)[0];
      let domainB = b.match(/\w*\.\w*$/)[0];
      return domainA < domainB ? -1 : domainA > domainB ? 1 : 0;
    });
  }

  constructor(key: string, domainCfg?: DomainCfg) {
    this.cfgKey = key;
    this.cfg = {};
    if (!domainCfg) {
      Object.assign(this.cfg, Domain._domainCfgDefaults);
    } else {
      this.cfg = domainCfg;
    }

    this.updateFromCfg();
  }

  // Updates the config from the domain and saves it
  async save(cfg: WebConfig) {
    if (cfg.domains) {
      this.updateCfg();

      if (JSON.stringify(this.cfg) === '{}') { // Nothing to save, so remove it
        delete cfg.domains[this.cfgKey];
      } else {
        cfg.domains[this.cfgKey] = this.cfg;
      }

      return await cfg.save('domains');
    }
  }

  updateCfg() {
    this.cfg.adv = this.advanced === true ? true : undefined;
    this.cfg.disabled = this.disabled === true ? true : undefined;
    this.cfg.enabled = this.enabled === true ? true : undefined;
    this.cfg.wordlist = this.wordlistId >= 0 ? this.wordlistId : undefined;
    this.cfg.audioList = this.audioWordlistId >= 0 ? this.audioWordlistId : undefined;
  }

  updateFromCfg() {
    this.advanced = this.cfg.adv;
    this.disabled = this.cfg.disabled;
    this.enabled = this.cfg.enabled;
    this.wordlistId = this.cfg.wordlist;
    this.audioWordlistId = this.cfg.audioList;
  }
}