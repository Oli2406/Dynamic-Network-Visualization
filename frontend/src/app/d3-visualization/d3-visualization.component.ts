import { Component, ElementRef, AfterViewInit, Input, OnChanges, SimpleChanges } from '@angular/core';
import * as d3 from 'd3';

@Component({
  selector: 'app-d3-visualization',
  templateUrl: './d3-visualization.component.html',
  standalone: true,
  styleUrls: ['./d3-visualization.component.css']
})
export class D3VisualizationComponent implements AfterViewInit, OnChanges {
  @Input() pickedYear: number | null = 1929;
  csvData: any[] = [];

  constructor(private el: ElementRef) {}

  ngAfterViewInit() {
    this.loadCSVData();
  }

  ngOnChanges(changes: SimpleChanges) {
    console.log('updating csv with year ' + this.pickedYear);
    if (changes['pickedYear'] && this.csvData.length > 0) {
      this.updateVisualization();
    }
  }

  loadCSVData() {
    console.log('updating csv with year ' + this.pickedYear);
    d3.csv('assets/MoMAExhibitions1929to1989.csv').then((data: any[]) => {
      this.csvData = data;
      this.updateVisualization();
    }).catch((error: any) => console.error('Error loading CSV:', error));
  }

  updateVisualization() {
    if (!this.pickedYear || this.csvData.length === 0) return;

    const filteredData = this.csvData.filter(d => +d.year === this.pickedYear);

    d3.select(this.el.nativeElement).select("#chart").html("");

    const width = 600, height = 400;

    const svg = d3.select(this.el.nativeElement)
      .select("#chart")
      .append("svg")
      .attr("width", width)
      .attr("height", height);

    const barHeight = 30;
    svg.selectAll("rect")
      .data(filteredData)
      .enter()
      .append("rect")
      .attr("x", 50)
      .attr("y", (d: any, i: number) => i * (barHeight + 5))
      .attr("width", (d: { value: string | number; }) => +d.value * 10)
      .attr("height", barHeight)
      .attr("fill", "#7600BC");

    svg.selectAll("text")
      .data(filteredData)
      .enter()
      .append("text")
      .attr("x", 10)
      .attr("y", (d: any, i: number) => i * (barHeight + 5) + barHeight / 2)
      .text((d: { name: any; }) => d.name)
      .attr("fill", "white")
      .attr("alignment-baseline", "middle");
  }
}
