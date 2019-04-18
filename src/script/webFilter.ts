import Domain from './domain';
import {Filter} from './lib/filter';
import Page from './page';
import WebAudio from './webAudio';
import WebConfig from './webConfig';
import './vendor/findAndReplaceDOMText';

interface Message {
  advanced?: boolean;
  counter?: number;
  disabled?: boolean;
  mute?: boolean;
  summary?: object;
}

export default class WebFilter extends Filter {
  advanced: boolean;
  cfg: WebConfig;
  disabled: boolean;
  lastHref: string;
  lastSubtitle: string;
  location: {
    hostname: string;
    href: string;
    pathname: string;
  }
  muted: boolean;
  mutePage: boolean;
  observer: MutationObserver;
  subtitleSelector: string;
  summary: object;
  volume: number;

  constructor() {
    super();
    this.advanced = false;
    this.muted = false;
    this.summary = {};
    this.volume = 1;

    // The hostname should resolve to the browser window's URI (or the parent of an IFRAME) for disabled/advanced page checks
    if (window.location == window.parent.location) {
      this.location = {
        hostname: document.location.hostname,
        href: document.location.href,
        pathname: document.location.pathname.replace(/^\//, '')
      };
    } else {
      this.location = {
        hostname: new URL(document.referrer).hostname,
        href: new URL(document.referrer).href,
        pathname: new URL(document.referrer).pathname.replace(/^\//, '')
      };
    }
    this.lastHref = this.location.href; // TODO: What about iFrames?
    // TODO: WORKING HERE - Testing when we detect a change
  }

  updateLocation() {
    // TODO
  }

  // Always use the top frame for page check
  advancedPage(): boolean {
    return Domain.domainMatch(this.location.hostname, this.cfg.advancedDomains);
  }

  advancedReplaceText(node) {
    filter.wordRegExps.forEach((regExp) => {
      // @ts-ignore - External library function
      findAndReplaceDOMText(node, {preset: 'prose', find: regExp, replace: function(portion, match) {
        // console.log('[APF] Advanced node match:', node.textContent); // DEBUG - Advanced match
        return filter.replaceText(match[0]);
      }});
    });
  }

  checkMutationForProfanity(mutation) {
    // console.count('checkMutationForProfanity'); // Benchmarking - Mutation
    // console.log('Mutation observed:', mutation); // DEBUG - Mutation
    mutation.addedNodes.forEach(node => {
      if (!Page.isForbiddenNode(node)) {
        // console.log('Added node(s):', node); // DEBUG - Mutation - addedNodes
        if (filter.mutePage && WebAudio.youTubeAutoSubsPresent(filter)) { // YouTube Auto subs
          if (WebAudio.youTubeAutoSubsSupportedNode(filter.location.hostname, node)) {
            WebAudio.cleanYouTubeAutoSubs(filter, node); // Clean Auto subs
          } else if (!WebAudio.youTubeAutoSubsNodeIsSubtitleText(node)) {
            filter.cleanNode(node); // Clean the rest of the page
          }
        } else if (filter.mutePage && WebAudio.supportedNode(filter.location.hostname, node)) {
          WebAudio.clean(filter, node, filter.subtitleSelector);
        } else {
          // console.log('Added node to filter', node); // DEBUG - Mutation addedNodes
          if (filter.advanced && node.parentNode) {
            filter.advancedReplaceText(node);
          } else {
            filter.cleanNode(node);
          }
        }
      }
      // else { console.log('Forbidden node:', node); } // DEBUG - Mutation addedNodes
    });

    mutation.removedNodes.forEach(node => {
      if (filter.mutePage && WebAudio.supportedNode(filter.location.hostname, node)) {
        WebAudio.unmute(filter);
      }
    });

    // Only process mutation change if target is text
    if (mutation.target && mutation.target.nodeName == '#text') {
      filter.checkMutationTargetTextForProfanity(mutation);
    }
  }

  checkMutationTargetTextForProfanity(mutation) {
    // console.count('checkMutationTargetTextForProfanity'); // Benchmarking - Executaion Count
    // console.log('Process mutation.target:', mutation.target, mutation.target.data); // DEBUG - Mutation target text
    if (!Page.isForbiddenNode(mutation.target)) {
      let result = this.replaceTextResult(mutation.target.data);
      if (result.modified) {
        // console.log('Text target changed:', result.original, result.filtered); // DEBUG - Mutation target text
        mutation.target.data = result.filtered;
      }
    }
    // else { console.log('Forbidden mutation.target node:', mutation.target); } // DEBUG - Mutation target text
  }

  cleanNode(node) {
    if (Page.isForbiddenNode(node)) { return false; }

    if (node.childElementCount > 0) { // Tree node
      let treeWalker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      while(treeWalker.nextNode()) {
        if (treeWalker.currentNode.childNodes.length > 0) {
          treeWalker.currentNode.childNodes.forEach(childNode => {
            this.cleanNode(childNode);
          });
        } else {
          this.cleanNode(treeWalker.currentNode);
        }
      }
    } else { // Leaf node
      if (node.nodeName) {
        if (node.textContent.trim() != '') {
          let result = this.replaceTextResult(node.textContent);
          if (result.modified) {
            // console.log('[APF] Normal node changed:', result.original, result.filtered); // DEBUG - Mutation node
            node.textContent = result.filtered;
          }
        }
      }
      // else { console.log('node without nodeName:', node); } // Debug
    }
  }

  activate() {
    let message: Message = { disabled: this.disabled };

    // Detect if we should mute audio for the current page
    this.mutePage = (this.cfg.muteAudio && Domain.domainMatch(this.location.hostname, WebAudio.supportedPages()));
    if (this.mutePage) { this.subtitleSelector = WebAudio.subtitleSelector(this.location.hostname); }

    // Check for advanced mode on current domain
    this.advanced = this.advancedPage();
    message.advanced = this.advanced; // Set badge color
    chrome.runtime.sendMessage(message);

    // Remove profanity from the main document and watch for new nodes
    this.advanced ? this.advancedReplaceText(document) : this.cleanNode(document);
    this.updateCounterBadge();
    this.observeNewNodes();
  }

  deactivate() {
    this.observer.disconnect();
    let message: Message = { disabled: this.disabled };
    chrome.runtime.sendMessage(message);
  }

  async start() {
    let self = this;

    // @ts-ignore: Type WebConfig is not assignable to type Config
    this.cfg = await WebConfig.build();

    this.init(); // TODO: Only if needed?

    // Setup MutationObserver to watch for DOM changes
    this.observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        self.checkMutationForProfanity(mutation);
      });
      self.updateCounterBadge();
    });

    this.watchForNavigation();

    // Check if the topmost frame is a disabled domain
    this.disabled = this.disabledPage();

    // if (!this.disabled) { this.activate(); }
    this.disabled ? this.deactivate() : this.activate();
  }

  // Always use the top frame for page check
  // Checks if the current page should be disabled
  // The filter is enabled if not explicitly disabled, or if the current page is in enabledPages
  // The filter is disabled if the domain is disabled, or if the current page is disabled in disabledPages
  disabledPage(): boolean {
    let self = this;
    let config;
    if (self.cfg.domains[self.location.hostname]) {
      config = self.cfg.domains[self.location.hostname];
    } else {
      config = Object.keys(self.cfg.domains).forEach(domain => {
        if (new RegExp('(^|\.)' + domain, 'i').test(self.location.hostname)) {
          return self.cfg.domains[domain];
        }
      });
    }

    if (config) {
      if (config.disabled) {
        let match = Domain.pageMatch(this.location.pathname, config.enabledPages);
        return match ? false : true;
      } else {
        let match = Domain.pageMatch(this.location.pathname, config.disabledPages);
        return match ? true : false;
      }
    } else {
      return false;
    }
  }

  foundMatch(word) {
    super.foundMatch(word);
    if (this.cfg.showSummary) {
      if (this.summary[word]) {
        this.summary[word].count += 1;
      } else {
        let result;
        if (this.cfg.words[word].matchMethod == 4) { // Regexp
          result = this.cfg.words[word].sub || this.cfg.defaultSubstitution;
        } else {
          result = filter.replaceText(word, false);
        }

        this.summary[word] = { filtered: result, count: 1 };
      }
    }
  }

  observeNewNodes() {
    let observerConfig = {
      characterData: true,
      characterDataOldValue: true,
      childList: true,
      subtree: true,
    };

    this.observer.observe(document, observerConfig);
  }

  watchForNavigation() {
    let self = this;
    window.onload = function() {
      let bodyList = document.querySelector("body");
      let observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) { // TODO: change to find?
          if (self.lastHref != document.location.href) { // TOOD: What about iFrames?
            console.log('Page navigation detected');

            self.lastHref = document.location.href;
            let changed = self.disabledPage();
            if (changed != self.disabled) {
              self.disabled = changed;
              self.disabled ? self.deactivate() : self.activate();
            }
          }
        });
      });

      observer.observe(bodyList, { childList: true, subtree: true });
    };
  }

  replaceTextResult(string: string, stats: boolean = true) {
    let result = {} as any;
    result.original = string;
    result.filtered = filter.replaceText(string);
    result.modified = (result.filtered != string);
    return result;
  }

  updateCounterBadge() {
    /* istanbul ignore next */
    // console.count('updateCounterBadge'); // Benchmarking - Executaion Count
    if (this.counter > 0) {
      try {
        if (this.cfg.showCounter) chrome.runtime.sendMessage({ counter: this.counter.toString() });
        if (this.cfg.showSummary) chrome.runtime.sendMessage({ summary: this.summary });
      } catch (e) {
        // console.log('Failed to sendMessage', e); // Error - Extension context invalidated.
      }
    }
  }
}

// Global
var filter = new WebFilter;
if (typeof window !== 'undefined' && ['[object Window]', '[object ContentScriptGlobalScope]'].includes(({}).toString.call(window))) {
  /* istanbul ignore next */
  // Send summary data to popup
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse){
    if (filter.cfg.showSummary && request.popup && filter.counter > 0) chrome.runtime.sendMessage({ summary: filter.summary });
  });

  /* istanbul ignore next */
  filter.start();
}