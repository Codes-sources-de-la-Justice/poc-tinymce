import { Input, Output, Component, OnInit, OnChanges, EventEmitter } from '@angular/core';
import { FormControl } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

@Component({
  selector: 'search-bar',
  templateUrl: './search-bar.component.html',
  styleUrls: ['./search-bar.component.css']
})
export class SearchBarComponent implements OnInit, OnChanges {
  searchInput = new FormControl({value: '', disabled: true});
  @Input() ready = false;
  @Input() searchResults = [];
  @Input() onClickResult: (id: string, pageIndex: number, rect: number[]) => void;
  @Output() onSearch = new EventEmitter<string>();

  constructor() { }

  public onClick = async (searchResult) => {
    await this.onClickResult(searchResult.pdfOid, searchResult.page, searchResult.boundingBox);
  }

  ngOnInit(): void {
    this.searchInput.valueChanges
    .pipe(distinctUntilChanged())
    .subscribe(value => this.onSearch.emit(value));
  }

  ngOnChanges(): void {
    if (this.ready) {
      this.searchInput.enable({emitEvent: false});
    } else {
      this.searchInput.disable({emitEvent: false});
    }
  }

}
