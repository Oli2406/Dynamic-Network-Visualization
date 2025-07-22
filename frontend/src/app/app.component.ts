import { Component, ViewChild, AfterViewInit } from '@angular/core';
import { D3VisualizationComponent } from './d3-visualization/d3-visualization.component';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  standalone: true,
  imports: [
    D3VisualizationComponent,
    FormsModule
  ],
  styleUrls: ['./app.component.css']
})
export class AppComponent implements AfterViewInit {
  title = 'frontend';
  pickedYear: number | null = 1932;
  showOnlyFuzzyExhibitions = true;
  aggregationMode: string = 'aggregateDisjoint';

  @ViewChild(D3VisualizationComponent)
  d3VisComponent!: D3VisualizationComponent;

  private viewInitialized = false;

  ngAfterViewInit(): void {
    this.viewInitialized = true;
    setTimeout(() => {
      if (this.d3VisComponent) {
        this.d3VisComponent.updateVisualization();
      }
    });
  }

  updateYear(yearInput: HTMLInputElement) {
    this.pickedYear = yearInput.value ? parseInt(yearInput.value, 10) : null;
  }

  onFuzzyToggle(checked: boolean) {
    if (this.viewInitialized && this.d3VisComponent) {
      this.d3VisComponent.updateVisualization();
    }
  }

  onAggregationChange(mode: string) {
    this.aggregationMode = mode;
    if(this.viewInitialized && this.d3VisComponent) {
      this.d3VisComponent.updateVisualization();
    }
  }
}
