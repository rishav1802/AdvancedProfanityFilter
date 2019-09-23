import WebFilter from './webFilter';
import BookmarkletFilter from './bookmarkletFilter';

export default class WebAudio {
  filter: WebFilter | BookmarkletFilter;
  lastFilteredNode: HTMLElement;
  muted: boolean;
  muteMethod: number;
  showSubtitles: number;
  sites: { [site: string]: AudioSite };
  subtitleSelector: string;
  supportedNode: Function;
  supportedPage: boolean;
  unmuteDelay: number;
  volume: number;
  youTube: boolean;
  youTubeAutoSubsMin: number;

  constructor(filter: WebFilter | BookmarkletFilter) {
    this.filter = filter;
    this.lastFilteredNode = null;
    this.muted = false;
    this.muteMethod = filter.cfg.muteMethod;
    this.showSubtitles = filter.cfg.showSubtitles;
    this.sites = Object.assign(WebAudio.sites, filter.cfg.customAudioSites);
    this.unmuteDelay = 0;
    this.volume = 1;
    this.youTubeAutoSubsMin = filter.cfg.youTubeAutoSubsMin;

    // Additional setup
    this.supportedPage = Object.keys(this.sites).includes(filter.hostname);
    if (this.supportedPage) {
      if (filter.hostname == 'www.youtube.com') { this.youTube = true; }
      this.subtitleSelector = this.sites[filter.hostname].subtitleSelector;
      this.supportedNode = this.buildSupportedNodeFunction();
    }
  }

  static readonly sites: { [site: string]: AudioSite } = {
    'abc.go.com': { className: 'akamai-caption-text', tagName: 'DIV' },
    'app.plex.tv': { dataPropPresent: 'dialogueId', subtitleSelector: 'span > span', tagName: 'DIV' },
    'www.amazon.com': { subtitleSelector: 'span.timedTextBackground', tagName: 'P' },
    'www.dishanywhere.com': { className: 'bmpui-ui-subtitle-label', tagName: 'SPAN' },
    'www.fox.com': { className: 'jw-text-track-container', subtitleSelector: 'div.jw-text-track-cue', tagName: 'DIV' },
    'www.hulu.com': { className: 'caption-text-box', subtitleSelector: 'p', tagName: 'DIV' },
    'www.nbc.com': { className: 'ttr-line', subtitleSelector: 'span.ttr-cue', tagName: 'DIV' },
    'www.netflix.com': { className: 'player-timedtext-text-container', subtitleSelector: 'span', tagName: 'DIV' },
    'www.sonycrackle.com': { textParentSelector: 'div.clpp-subtitles-container' },
    'www.syfy.com': { className: 'ttr-line', subtitleSelector: 'span.ttr-cue', tagName: 'DIV' },
    'www.universalkids.com': { subtitleSelector: 'div.gwt-HTML', tagName: 'DIV' },
    'www.usanetwork.com': { className: 'ttr-line', subtitleSelector: 'span.ttr-cue', tagName: 'DIV' },
    'www.vudu.com': { subtitleSelector: 'span.subtitles', tagName: 'DIV' },
    'www.youtube.com': { className: 'caption-window', subtitleSelector: 'span.ytp-caption-segment', tagName: 'DIV' }
  }

  buildSupportedNodeFunction(): Function {
    let { className, containsSelector, dataPropPresent, hasChildrenElements, subtitleSelector, tagName, textParentSelector } = this.sites[this.filter.hostname];

    // Plain text mode
    if (textParentSelector) {
      return new Function('node',`
      if (node.nodeName === '#text') {
        let textParent = document.querySelector('${textParentSelector}');
        if (textParent && textParent.contains(node)) { return true; }
      }
      return false;`);
    }

    // Normal mode
    if (!tagName) { throw('tagName is required.'); }

    return new Function('node',`
    if (node.nodeName == '${tagName.toUpperCase()}') {
      ${className ? `if (!node.className || !node.className.includes('${className}')) { return false; }` : ''}
      ${dataPropPresent ? `if (!node.dataset || !node.dataset.hasOwnProperty('${dataPropPresent}')) { return false; }` : ''}
      ${hasChildrenElements ? 'if (typeof node.childElementCount !== "number" || node.childElementCount < 1) { return false; }' : ''}
      ${subtitleSelector ? `if (typeof node.querySelector !== 'function' || !node.querySelector('${subtitleSelector}')) { return false; }` : ''}
      ${containsSelector ? `if (typeof node.querySelector !== 'function' || !node.querySelector('${containsSelector}')) { return false; }` : ''}
      return true;
    } else {
      return false;
    }`.replace(/^\s*\n/gm, ''));
  }

  clean(subtitleContainer): void {
    let filtered = false;
    let subtitles = this.subtitleSelector ? subtitleContainer.querySelectorAll(this.subtitleSelector) : [subtitleContainer];

    // Process subtitles
    subtitles.forEach(subtitle => {
      // innerText handles line feeds/spacing better, but is not available to #text nodes
      let textMethod = subtitle.nodeName === '#text' ? 'textContent' : 'innerText';
      let result = this.filter.replaceTextResult(subtitle[textMethod]);
      if (result.modified) {
        filtered = true;
        subtitle[textMethod] = result.filtered;
        this.mute(); // Mute the audio if we haven't already
        if (subtitle.nodeName === '#text') { this.lastFilteredNode = subtitle; }
      }
    });

    // Subtitle display - 0: Show all, 1: Show only filtered, 2: Show only unfiltered, 3: Hide all
    switch (this.showSubtitles) {
      case 1: if (!filtered) { subtitles.forEach(subtitle => { subtitle.textContent = ''; }); } break;
      case 2: if (filtered) { subtitles.forEach(subtitle => { subtitle.textContent = ''; }); } break;
      case 3: subtitles.forEach(subtitle => { subtitle.textContent = ''; }); break;
    }

    if (filtered) { this.filter.updateCounterBadge(); } // Update if modified
  }

  cleanYouTubeAutoSubs(node): void {
    let result = this.filter.replaceTextResult(node.textContent);
    if (result.modified) {
      node.textContent = result.filtered;
      this.mute();
      this.unmuteDelay = null;
      this.filter.updateCounterBadge();
    } else {
      if (this.muted) {
        if (this.youTubeAutoSubsMin > 0) {
          let currentTime = document.getElementsByTagName('video')[0].currentTime;
          if (this.unmuteDelay == null) { // Start tracking unmuteDelay when next unfiltered word is found
            this.unmuteDelay = currentTime;
          } else {
            if (currentTime < this.unmuteDelay) { this.unmuteDelay = 0; } // Reset unmuteDelay if video reversed
            if (currentTime > (this.unmuteDelay + this.youTubeAutoSubsMin)) { // Unmute if its been long enough
              this.unmute();
            }
          }
        } else { // Unmute immediately if youTubeAutoSubsMin = 0
          this.unmute();
        }
      }
    }
  }

  mute(): void {
    if (!this.muted) {
      this.muted = true;

      switch(this.muteMethod) {
        case 0: // Mute tab
          chrome.runtime.sendMessage({ mute: true });
          break;
        case 1: { // Mute video
          let video = document.getElementsByTagName('video')[0];
          if (video && video.volume != null) {
            this.volume = video.volume; // Save original volume
            video.volume = 0;
          }
          break;
        }
      }
    }
  }

  playing(video: HTMLMediaElement): boolean {
    return !!(video.currentTime > 0 && !video.paused && !video.ended && video.readyState > 2);
  }

  unmute(): void {
    this.muted = false;

    switch(this.muteMethod) {
      case 0: // Mute tab
        chrome.runtime.sendMessage({ mute: false });
        break;
      case 1: { // Mute video
        let video = document.getElementsByTagName('video')[0];
        if (video && video.volume != null) {
          video.volume = this.volume;
        }
        break;
      }
    }
  }

  youTubeAutoSubsCurrentRow(node): boolean {
    return !!(node.parentElement.parentElement == node.parentElement.parentElement.parentElement.lastChild);
  }

  youTubeAutoSubsNodeIsSubtitleText(node): boolean {
    let captionWindow = document.querySelector('div.caption-window'); // YouTube Auto-gen subs
    return !!(captionWindow && captionWindow.contains(node));
  }

  youTubeAutoSubsPresent(): boolean {
    return !!(document.querySelector('div.ytp-caption-window-rollup'));
  }

  youTubeAutoSubsSupportedNode(node: any): boolean {
    if (node.nodeName == '#text' && node.textContent != '') {
      return !!(this.youTubeAutoSubsNodeIsSubtitleText(node));
    }
    return false;
  }
}