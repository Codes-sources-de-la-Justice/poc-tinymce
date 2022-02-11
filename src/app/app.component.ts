import { Component, VERSION } from '@angular/core';
import PSPDFKit from 'pspdfkit';

const curTab = {
  uri: "assets/dummy.pdf",
  title: "PDF 01"
};

const allTabs = {
  "assets/dummy.pdf": {
    title: "PDF 01",
    uri: "assets/dummy.pdf"
  }
};

const initialTabs = [ curTab ];
type Tab = {
  uri: string;
};

function loadPDF(uri, toolbarItems) {
    return PSPDFKit.load({
      baseUrl: document.baseURI + "assets/",
      container: '#container',
      document: uri,
      styleSheets: ['/assets/styles.css'],
      toolbarItems,
    }).then((instance) => {
      console.log('PSPDFKit loaded!');
      (window as any).instance = instance;
      return instance;
    });
}

class TabService {
  activeEditor = null;
  activeInstance = null;
  activeTab = 0;
  openTabs = initialTabs;
  toolbarItems = [];

  constructor() {
    const linkCurrentPageToolbarItem = {
      type: ("custom" as any),
      id: "link-current-page",
      title: "Ajouter un lien vers cette page dans les notes",
      onPress: evt => this.linkToCurrentPage()
    };

    this.toolbarItems.push(linkCurrentPageToolbarItem);
  }

  getCurrentTab() {
    return this.openTabs[this.activeTab];
  }

  getCurrentPage() {
    return this.activeInstance.viewState.currentPageIndex;
  }

  linkToCurrentDocument() {
    this.insertLinkToEditor(this.getLinkFor({ tab: this.getCurrentTab() }));
  }

  linkToCurrentPage() {
    this.insertLinkToEditor(this.getLinkFor({ tab: this.getCurrentTab(), page: this.getCurrentPage() }));
  }

  reloadPDF() {
    const { uri } = this.getCurrentTab();
    if (this.activeInstance) {
      PSPDFKit.unload(this.activeInstance);
    }
    return loadPDF(uri, this.toolbarItems).then(instance => {
      this.activeInstance = instance;
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
    toolbar: `customLinkButton`,
    //base_url: '/tinymce', // Root for resources
    //suffix: '.min', // Suffix to use when loading resources
  };

  ngAfterViewInit() {
    this.tabService.reloadPDF();

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
