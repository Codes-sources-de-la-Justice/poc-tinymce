import { Component, VERSION } from '@angular/core';
import PSPDFKit from 'pspdfkit';

let counter = 0;

const tabs = [
  { tab: '01.pdf' },
  { tab: '02.pdf' },
  { tab: '03.pdf' },
];

@Component({
  selector: 'my-app',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  name = 'Angular ' + VERSION.major;
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

  ngOnInit() {
    PSPDFKit.load({
      container: '#container',
      document:
        'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', // Hélas, ça ne charge pas le PDF :(
      styleSheets: ['/assets/styles.css'],
    }).then((instance) => {
      console.log('PSPDFKit loaded!');
      console.log('API docs: https://pspdfkit.com/api/web/');
      console.log('Guides: https://pspdfkit.com/guides/web/');
    });

    this.tinymceOptions['setup'] = function setup(editor: any) {
      function get_current_tab() {
        const cur_tab = tabs[counter % tabs.length];
        counter += 1;
        return cur_tab;
      }

      function link_current_doc(item) {
        console.log('insérer le lien vers le tab', get_current_tab(), item);
        console.log(editor.selection.getNode());
        const { tab } = get_current_tab();
        // Plusieurs pistes ici:
        // - un <button /> mais le styling TinyMCE est pas très joli
        //   -> de plus, on perd les menus contextuels de manipulations des liens (remove link, open link, etc.)
        // - un <a href="#">, a le bon styling, peut se faire changer par sélection puis reclic sur lier
        if (!!editor.selection && !editor.selection.isCollapsed()) {
          // Petit bug: sélection un coup, puis une seconde sélection et un lien par dessus contextuel
          // cause une insertion d'un excès de noeuds, j'ai pas investigué pourquoi mais je peux si nécessaire
          // Il faut renforcer la condition de la ligne 59 à mon avis
          editor.insertContent(
            `<a data-internal-link="${tab}" href="#">${
              editor.selection.getNode().innerHTML
            }</a>`
          );
        } else {
          editor.insertContent(
            `<a data-internal-link="${tab}" href="#">${tab}</button>`
          );
        }
      }

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
        onAction: link_current_doc,
        onSetup: function (buttonApi) {
          const clickOnInternalLink = function (evtApi) {
            // On peut intercepter les clics vers les liens ici et cancel l'action au niveau navigateur.
            // En raison des contraintes de sécurité de Stackblitz, on peut pas bien voir le log de la console.
            // Il faut ouvrir le logging au niveau du navigateur et constater que les erreurs passent bien par la bonne stacktrace.
            console.log('clicked', evtApi, this.target);
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
