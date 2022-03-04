import { Component, VERSION } from '@angular/core';
import PSPDFKit from 'pspdfkit';
import { Dexie, liveQuery } from 'dexie';
import 'dexie-observable';
import 'dexie-syncable';
import { applyEncryptionMiddleware, UNENCRYPTED_LIST, NON_INDEXED_FIELDS } from 'dexie-encrypted';
import lunr from 'lunr';
require('lunr-languages/lunr.stemmer.support')(lunr);
require('lunr-languages/lunr.fr')(lunr);

// Register websocket protocol
import './websocket-sync-protocol.js';
// Load WebSocket shim
//import './websocketserver-shim.js';
// Load WebSocket server
//import '../websocket-server.js';

// TODO: online-offline connectivity indicator.
// when online back, connect to WebSocket to perform sync
// when offline, cut the connection

const symmetricKey = new Uint8Array(Array(32).fill(0)); // Null key.

/*applyEncryptionMiddleware(db, symmetricKey, {
  pdfs: NON_INDEXED_FIELDS,
  instantJson: UNENCRYPTED_LIST
});*/

interface IPDF {
  oid?: string;
  filename: string;
  title: string;
  instantJSON: any;
  blob: Blob;
}


class AppDB extends Dexie {
  pdfs!: Dexie.Table<IPDF, string>;

  constructor() {
    super("AppDB");

    this.version(1).stores({
      pdfs: "$$oid,&filename,title,instantJSON"
    });
  }
}

const db = new AppDB();
(window as any).db = db;

async function blobFromUri(uri) {
  const resp = await fetch(uri);
  return resp.blob();
}

function startSync() {
  db.syncable.connect("websocket", "ws://127.0.0.1:8000");
  db.syncable.on('statusChanged', function (newStatus, url) {
    console.log("Sync status changed: " + Dexie.Syncable.StatusTexts[newStatus]);
  });
}

async function seed() {
  await db.pdfs.clear();
  await db.pdfs.bulkAdd([
    { filename: "assets/dummy.pdf", title: "Dummy PDF", blob: await blobFromUri("assets/dummy.pdf"), instantJSON: null },
    { filename: "assets/sample.pdf", title: "Sample PDF", blob: await blobFromUri("assets/sample.pdf"), instantJSON: null }
  ]);
  return true;
}

async function isStoragePersisted() {
  return await navigator.storage && navigator.storage.persisted &&
    navigator.storage.persisted();
}

async function showEstimatedQuota() {
  if (navigator.storage && navigator.storage.estimate) {
    const estimation = await navigator.storage.estimate();
    console.log(`Quota: ${estimation.quota/(1024*1024*1024)} GB`);
    console.log(`Usage: ${estimation.usage/(1024*1024*1024)} GB`);
  } else {
    console.error("StorageManager not found");
  }
}

async function persist() {
  const persisted = await navigator.storage.persisted();
  const permission = await navigator.permissions.query({name: "persistent-storage"});
  if (!persisted && permission.state == "granted") {
    return navigator.storage.persist();
  } else if (!persisted && permission.state == "prompt") {
    console.log('prompt persist');
    return navigator.storage.persist();
  }
}


const allTabs = {
  "assets/dummy.pdf": {
    title: "PDF 01",
    uri: "assets/dummy.pdf"
  },
  "assets/sample.pdf": {
    title: "PDF 02",
    uri: "assets/sample.pdf"
  }
};

type Tab = {
  uri: string;
};

async function loadPDF(uri, toolbarItems) {
  const { instantJSON, blob } = await db.pdfs.get(uri);
  const docBlobObjectURL = URL.createObjectURL(blob);
  const instance = await PSPDFKit.load({
    baseUrl: document.baseURI + "assets/",
    container: '#container',
    document: docBlobObjectURL,
    styleSheets: ['/assets/styles.css'],
    toolbarItems,
    instantJSON,
    autoSaveMode: PSPDFKit.AutoSaveMode.IMMEDIATE,
  });

  URL.revokeObjectURL(docBlobObjectURL);
  (window as any).instance = instance;

  return instance;
}

class TabService {
  activeEditor = null;
  activeInstance = null;
  activeTab = 0;
  openTabs = [];
  toolbarItems = [...PSPDFKit.defaultToolbarItems];

  constructor() {
    const linkCurrentPageToolbarItem = {
      type: ("custom" as any),
      id: "link-current-page",
      title: "Ajouter un lien vers cette page dans les notes",
      onPress: evt => this.linkToCurrentPage()
    };

    this.toolbarItems.push(linkCurrentPageToolbarItem);
  }

  async onPDFChanges() {
    const oid = this.openTabs[this.activeTab].uri;
    await db.pdfs.update(oid, {
      instantJSON: await this.activeInstance.exportInstantJSON()
    });
  }

  getCurrentTab() {
    return this.openTabs[this.activeTab];
  }

  getCurrentPage() {
    return this.activeInstance.viewState.currentPageIndex;
  }

  linkToTab(tab) {
    this.insertLinkToEditor(this.getLinkFor({ tab }));
  }

  linkToCurrentDocument() {
    this.insertLinkToEditor(this.getLinkFor({ tab: this.getCurrentTab() }));
  }

  linkToCurrentPage() {
    this.insertLinkToEditor(this.getLinkFor({ tab: this.getCurrentTab(), page: this.getCurrentPage() }));
  }

  async reloadPDF() {
    // No active tab.
    if (this.activeTab >= this.openTabs.length) {
      return;
    }

    const { uri } = this.getCurrentTab();
    if (this.activeInstance) {
      PSPDFKit.unload(this.activeInstance);
    }
    this.activeInstance = await loadPDF(uri, this.toolbarItems);
    this.setupEventListenersOnInstance(this.activeInstance);
  }

  setupEventListenersOnInstance(instance) {
    ["annotations.didSave", "bookmarks.didSave"].forEach(evt => {
      instance.addEventListener(evt, () => this.onPDFChanges());
    });
  }

  getLinkFor({ tab, page }: { tab: Tab, page?: string }) {
    return {
      internal: !!page ? `${tab.uri}@${page}` : tab.uri,
      text: page != null ? `${tab.uri} (page ${page + 1})` : tab.uri
    };
  }

  openNewTab(tab) {
    this.openTabs.push(tab);
    this.activeTab = this.openTabs.length - 1;
    return this.reloadPDF();
  }

  locateExistingTab(uri) {
    const targetTab = this.openTabs.findIndex(item => item.uri === uri);
    if (targetTab === -1) {
      return null;
    } else {
      return targetTab;
    }
  }

  focusTab(tabIndex) {
    this.activeTab = tabIndex;
    return this.reloadPDF();
  }

  scrollToPage(pageIndex) {
    this.activeInstance.setViewState(state => state.set("currentPageIndex", pageIndex));
  }

  openInternalLink(link) {
    let page = null;
    let uri;
    if (link.includes("@")) {
      [uri, page] = link.split("@");
    } else {
      uri = link;
    }

    const tabId = this.locateExistingTab(uri);
    let p = null
    if (tabId != null) {
      p = this.focusTab(tabId);
    } else {
      // TODO: fix it using Dexie
      p = this.openNewTab(allTabs[uri]);
    }

    if (page != null) {
      Promise.resolve(p).then(() => this.scrollToPage(+page));
    } 
  }

  insertLinkToEditor(link) {
    const editor = this.activeEditor;
    // Plusieurs pistes ici:
    // - un <button /> mais le styling TinyMCE est pas très joli
    //   -> de plus, on perd les menus contextuels de manipulations des liens (remove link, open link, etc.)
    // - un <a href="#">, a le bon styling, peut se faire changer par sélection puis reclic sur lier

    if (!!editor.selection && !editor.selection.isCollapsed()) {
      // Petit bug: sélection un coup, puis une seconde sélection et un lien par dessus contextuel
      // cause une insertion d'un excès de noeuds, j'ai pas investigué pourquoi mais je peux si nécessaire
      // Il faut renforcer la condition de la ligne 59 à mon avis
      editor.insertContent(
        `<a data-internal-link="${link.internal}" href="#">${
          editor.selection.getNode().innerHTML
        }</a>`
      );
    } else {
      editor.insertContent(
        `<a data-internal-link="${link.internal}" href="#">${link.text}</button>`
      );
    }
  }
}

@Component({
  selector: 'my-app',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  name = 'Angular ' + VERSION.major;
  tabService = new TabService();
  tinymceOptions = {
    height: 500,
    menubar: false,
    plugins: [
      'advlist autolink lists link image charmap print preview anchor',
      'searchreplace visualblocks code fullscreen',
      'insertdatetime media table paste code help wordcount',
    ],
    toolbar: `customLinkButton openDocumentsMenu copyEverything`,
    //base_url: '/tinymce', // Root for resources
    //suffix: '.min', // Suffix to use when loading resources
  };

  public focusTab = tabIndex => {
    this.tabService.focusTab(tabIndex)
  };

  ngAfterViewInit() {
    persist().then(() => {
      console.log('Persistence layer enabled.');
      return db.pdfs.count();
    }).then(count => {
      return Promise.resolve(count === 0 ? seed() : false);
    }).then(seeded => {
      if (seeded) {
        console.log('Seeding done.');
      } else {
        console.log('Already seeded.');
      }
      return showEstimatedQuota();
    }).then(() => {
      console.log('DB ready.');
      return db.pdfs.toArray();
    }).then(pdfs => {
      this.tabService.openTabs = pdfs.map(({oid, title}) => ({
        title,
        uri: oid
      }));
      this.tabService.reloadPDF();
    });

    const that = this;

    this.tinymceOptions['setup'] = function setup(editor: any) {
      (window as any).editor = editor;
      that.tabService.activeEditor = editor;

      // Menu contextuel lorsqu'on sélectionne un texte.
      editor.ui.registry.addContextToolbar('textselection', {
        predicate: function (node) {
          return !editor.selection.isCollapsed();
        },
        items: 'customLinkButton',
        position: 'selection',
        scope: 'node',
      });

      editor.ui.registry.addMenuButton('openDocumentsMenu', {
        icon: 'link',
        text: 'Documents ouverts',
        fetch: function (callback) {
          callback(that.tabService.openTabs.map(tab => ({
            type: "menuitem",
            text: `${tab.title}`,
            onAction: function () {
              that.tabService.linkToTab(tab);
            }
          })));
        }
      });

      editor.ui.registry.addButton('copyEverything', {
        icon: 'copy',
        text: 'Copier toute la note',
        onAction: () => {
          const contents = editor.getContent();
          navigator.clipboard.writeText(contents).then(
            () => {
              console.log("Copied!");
            }
          ).catch(err => {
            console.log(err);
          });
        }
      });


      // Bouton de la toolbar.
      editor.ui.registry.addButton('customLinkButton', {
        icon: 'link',
        text: 'Lier le présent document',
        onAction: () => that.tabService.linkToCurrentDocument(),
        onSetup: function (buttonApi) {
          const clickOnInternalLink = function (evtApi) {
            // On peut intercepter les clics vers les liens ici et cancel l'action au niveau navigateur.
            // En raison des contraintes de sécurité de Stackblitz, on peut pas bien voir le log de la console.
            // Il faut ouvrir le logging au niveau du navigateur et constater que les erreurs passent bien par la bonne stacktrace.
            if (evtApi.target.hasAttribute("data-internal-link")) {
              const internalLink = evtApi.target.getAttribute("data-internal-link");
              console.log("clicked on an internal link to", internalLink);
              that.tabService.openInternalLink(internalLink);
            }
          };
          editor.on('click', clickOnInternalLink);

          /* onSetup should always return the unbind handlers */
          return function (buttonApi) {
            editor.off('click', clickOnInternalLink);
          };
        },
      });
    };
  }
}
