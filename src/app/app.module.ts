import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';

import { AppComponent } from './app.component';
import { HelloComponent } from './hello.component';

import { EditorModule, TINYMCE_SCRIPT_SRC } from '@tinymce/tinymce-angular';

@NgModule({
  imports: [BrowserModule, FormsModule, EditorModule],
  declarations: [AppComponent, HelloComponent],
  bootstrap: [AppComponent],
  //providers: [
  //  { provide: TINYMCE_SCRIPT_SRC, useValue: 'tinymce/tinymce.min.js' },
  //],
})
export class AppModule {}
