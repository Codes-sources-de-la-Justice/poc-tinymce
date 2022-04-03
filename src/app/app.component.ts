import { Component, VERSION } from '@angular/core';
import PSPDFKit from 'pspdfkit';
import { Dexie, liveQuery } from 'dexie';
import 'dexie-observable';
import 'dexie-syncable';
import { applyEncryptionMiddleware, UNENCRYPTED_LIST, NON_INDEXED_FIELDS } from 'dexie-encrypted';
import lunr from 'lunr';
import SyncClient from 'sync-client';
require('lunr-languages/lunr.stemmer.support')(lunr);
require('lunr-languages/lunr.fr')(lunr);

// TODO in order:
// 4. restore reactivity on tabs using liveQuery on openTabs
// 5. fix the look of internal links
// 6. show how many tabs of the app are opened currentlyp
// 7. perform indexation in background with hidden instance.

// TODO:
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

interface IText {
  oid?: string;
  pdfOid: string;
  text: string;
  page: number;
  boundingBox: number[];
}

const dbVersions = [
  {
    version: 1,
    stores: {
      pdfs: "$$oid,&filename,title,instantJSON,blob",
      texts: "$$oid,pdfOid,text,page,*boundingBox"
    }
  }
];

const SYNC_URL = 'http://poc.j.lahfa.fr:3000';
const db = new SyncClient('EtudeDB', dbVersions);
(window as any).db = db;

function bbToArray(bbox) {
  return [bbox.left, bbox.top, bbox.width, bbox.height];
}

function arrayToRect(bboxArray) {
  return new PSPDFKit.Geometry.Rect({
    left: bboxArray[0],
    top: bboxArray[1],
    width: bboxArray[2],
    height: bboxArray[3]
  });
}

async function blobFromUri(uri) {
  const resp = await fetch(uri);
  return resp.blob();
}

async function startSync(connected) {
  db.statusChange(SYNC_URL, function (newStatus) {
    console.log(`Sync status changed (from ${SYNC_URL}): ${newStatus}`);
  });

  if (connected) {
    try {
      await db.connect(SYNC_URL);
    } catch (e) {
      console.error('Tried to connect, but failed', e);
    }
  }
}

async function mkPdfRecord(filename, title): Promise<IPDF> {
  return {
    filename,
    title,
    blob: await blobFromUri(filename),
    instantJSON: null
  }
}

async function seed() {
  await db.pdfs.clear();
  await db.pdfs.bulkAdd(
      await Promise.all([
        ["dummy", "Dummy"],
        ["sample", "Sample"],
        ["independence", "Indépendance de la Justice"],
        ["justice_01", "C'est quoi la Justice ?"],
        ["justice_de_paix", "Justice de Paix"],
        ["justice_qualite", "Qualité de la Justice"],
        ["numerisation", "Numérisation de la Justice"]
      ].map(([filename, title]) => mkPdfRecord(`assets/${filename}.pdf`, title)))
  );
  // TODO: extract text from all pdf using pspdfkit
  // index them
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


type Tab = {
  uri: string;
};

async function loadPDF(uri, toolbarItems) {
  const { instantJSON, blob } = await db.pdfs.get(uri);
  const docBlobObjectURL = URL.createObjectURL(blob);
  const baseUrl = document.baseURI[document.baseURI.length - 1] === '#' ? document.baseURI.slice(0, -1) : document.baseURI;
  console.log('baseUrl', baseUrl)
  try {
    const instance = await PSPDFKit.load({
      baseUrl: `${baseUrl}assets/`,
      container: '#container',
      document: docBlobObjectURL,
      styleSheets: ['/assets/styles.css'],
      toolbarItems,
      instantJSON,
      enableServiceWorkerSupport: true,
      autoSaveMode: PSPDFKit.AutoSaveMode.IMMEDIATE,
    });

    (window as any).instance = instance;
    return instance;
  } catch (e) {
    console.error('Failure during PDF loading', e);
  } finally {
    URL.revokeObjectURL(docBlobObjectURL);
  }
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
    console.log('instance ready', this.activeInstance)
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

  openOrFocusTab(uri) {
    const tabId = this.locateExistingTab(uri);
    return this.focusTab(tabId);
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
      console.error('BUG');
      //p = getPdfByUri(uri).then(record => this.openNewTab(record));
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

async function indexPDFs(tabService) {
    const pdfs = await db.pdfs.toArray();

    // Do not re-extract if we already have every IDs we want.
    console.log('indexing PDFs...')
    const allIndexed: IText[][] = await Promise.all(pdfs.map(({oid}) => db.texts.where({pdfOid: oid}).toArray()));
    const indexedOids = new Set(allIndexed.filter(indexed => indexed.length > 0).map(indexed => indexed[0].pdfOid));
    const documents = allIndexed.filter(indexed => indexed.length > 0).flatMap(pages => {
      const pdf = pdfs.find(pdf => pdf.oid === pages[0].pdfOid);
      return pages.map(({oid, pdfOid, text, page, boundingBox}) => ({
        oid,
        pdfOid,
        title: pdf.title,
        pageIndex: page,
        text,
        boundingBox
      }));
    });

    console.log('initializing with', documents.length, 'in database');
    console.time('Extracting text for the remaining PDFs');
    for (let [index, {oid, title}] of pdfs.entries()) {
      if (indexedOids.has(oid)) {
        console.log(`${oid}: already indexed.`)
        continue;
      }

      tabService.activeTab = index;
      await tabService.reloadPDF();
      const label = `Extracting text from ${oid}/${title}/${tabService.activeInstance}`;
      console.time(label);
      const n = tabService.activeInstance.totalPageCount;
      const text = [];
      for (let i = 0 ; i < n ; i++) {
        const textLines = await tabService.activeInstance.textLinesForPageIndex(i);
        textLines.forEach(lines => {
          documents.push({oid: null, pdfOid: oid, title, text: lines.contents.toString(), pageIndex: i, boundingBox: bbToArray(lines.boundingBox)});
        });
      }
      console.timeEnd(label);
    }
    console.timeEnd('Extracting text for the remaining PDFs');

    tabService.activeTab = 0;
    await tabService.reloadPDF();

    console.time('Bulk-putting the documents in the DB')
    await db.texts.bulkPut(
      documents.map(({oid, pdfOid, text, pageIndex, boundingBox}) => {
        const doc = {
          pdfOid,
          page: pageIndex,
          text,
          boundingBox
        };

        if (oid) {
          doc['oid'] = oid;
        }

        return doc;
      })
    );
    console.timeEnd('Bulk-putting the documents in the DB')

    console.time('Building the indexer...');
    const indexer = lunr(function () {
      this.ref('oid');
      this.field('title');
      this.field('text');
      this.metadataWhitelist = ['position'];

      documents.forEach(function (doc) {
        this.add(doc);
      }, this);
    });
    console.timeEnd('Building the indexer...');
    console.log('Indexer built.')

    console.log(documents);

    return indexer;
}

@Component({
  selector: 'my-app',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  name = 'Angular ' + VERSION.major;
  connected = true;
  searchInput = "";
  searchResults = [];
  indexer = null;
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
    base_url: '/tinymce', // Root for resources
    suffix: '.min', // Suffix to use when loading resources
  };

  public focusTab = tabIndex => {
    this.tabService.focusTab(tabIndex)
  };

  public resetDB = async () => {
    return seed();
  };

  public performSearch (value) {
    console.time(`search ${value}`)
    Promise.all(this.indexer.search(value).map(async (searchResult) => {
      const indexRecord = await db.texts.get(searchResult.ref);
      const pdf = await db.pdfs.get(indexRecord.pdfOid);

      // compute chunks of texts using matchData.

      return {
        title: pdf.title,
        pdfOid: pdf.oid,
        page: indexRecord.page,
        text: indexRecord.text,
        boundingBox: indexRecord.boundingBox,
        ...searchResult
      };
    })).then(searchResults => {
      console.timeEnd(`search ${value}`)
      console.log(searchResults);
      this.searchResults = searchResults
    });
  };

  public jumpToPDFAndRect = async (id, pageIndex, rect) => {
    await this.tabService.openOrFocusTab(id);
    const pspdfkitRect = arrayToRect(rect);
    await this.tabService.activeInstance.jumpToRect(pageIndex, pspdfkitRect);
    /*const annotation = new PSPDFKit.Annotations.HighlightAnnotation({
        pageIndex: pageIndex,
        rects: [pspdfkitRect] as any,
        boundingBox: PSPDFKit.Geometry.Rect.union([pspdfkitRect] as any)
    });
    await this.tabService.activeInstance.create([annotation]);*/
  }

  ngAfterViewInit() {
    window.addEventListener('online', () => { this.connected = true; db.connect(SYNC_URL); });
    window.addEventListener('offline', () => { this.connected = false; });

    persist().then(() => {
      console.log('Persistence layer enabled.');
      return startSync(this.connected);
    }).then(() => {
      console.log('Synchronization started.');
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
      return this.tabService.reloadPDF();
    }).then(() => {
      return indexPDFs(this.tabService);
    }).then(indexer => {
      (window as any).indexer = indexer;
      this.indexer = indexer;
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
