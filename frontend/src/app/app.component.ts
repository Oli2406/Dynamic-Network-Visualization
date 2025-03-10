import { Component } from '@angular/core';
import {D3VisualizationComponent} from './d3-visualization/d3-visualization.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  standalone: true,
  imports: [
    D3VisualizationComponent
  ],
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  title = 'frontend';
  pickedYear: number | null = 1929;

  updateYear(yearInput: HTMLInputElement) {
    this.pickedYear = yearInput.value ? parseInt(yearInput.value, 10) : null;
  }
}
