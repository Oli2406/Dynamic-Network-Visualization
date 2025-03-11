import { Component, ElementRef, AfterViewInit, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core';
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
  @ViewChild('chartContainer', { static: false }) chartContainer!: ElementRef;

  constructor(private el: ElementRef) {}

  ngAfterViewInit() {
    setTimeout(() => {
      this.loadCSVData();
    }, 100);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['pickedYear'] && this.csvData.length > 0) {
      this.updateVisualization();
    }
  }

  loadCSVData() {
    d3.csv('assets/MoMAExhibitions1929to1989.csv').then((data: any[]) => {
      this.csvData = data;
      this.updateVisualization();
    }).catch((error: any) => console.error('Error loading CSV:', error));
  }

  updateVisualization() {
    if (!this.pickedYear || this.csvData.length === 0) return;

    interface ArtistNode extends d3.SimulationNodeDatum {
      name: string;
      exhibition: string;
      cluster?: { x: number; y: number };
    }

    // **Filter data for the selected year**
    const filteredData = this.csvData.filter(d => {
      const year = d.ExhibitionBeginDate ? new Date(d.ExhibitionBeginDate).getFullYear() : null;
      return year === this.pickedYear;
    });

    const chartContainer = d3.select<HTMLElement, unknown>(this.chartContainer.nativeElement);
    chartContainer.html("");

    if (filteredData.length === 0) {
      chartContainer.append("p").text("No exhibitions found for this year.").style("color", "red");
      return;
    }

    // **Count artists per exhibition**
    const exhibitionCounts = new Map<string, number>();
    filteredData.forEach(d => {
      exhibitionCounts.set(d.ExhibitionTitle, (exhibitionCounts.get(d.ExhibitionTitle) || 0) + 1);
    });

    const maxArtists = Math.max(...exhibitionCounts.values());

    // **Improved Scale for Group Sizes**
    const groupSizeScale = d3.scaleSqrt()
      .domain([1, maxArtists])
      .range([10, 100])
      .clamp(true);

    // **Generate initial cluster positions**
    const clusterNodes = Array.from(exhibitionCounts.keys()).map((exhibition, i) => ({
      id: exhibition,
      size: groupSizeScale(exhibitionCounts.get(exhibition) || 1),
      x: Math.random() * 800 - 400,
      y: Math.random() * 500 - 250
    }));

    // **Cluster simulation for positioning**
    const clusterSimulation = d3.forceSimulation(clusterNodes)
      .force("x", d3.forceX(0).strength(0.1))
      .force("y", d3.forceY(0).strength(0.1))
      .force("collide", d3.forceCollide(d => d.size * 1.1))
      .force("charge", d3.forceManyBody().strength(-150))
      .stop();

    for (let i = 0; i < 300; i++) clusterSimulation.tick();

    // **Map final positions for cluster centers**
    const clusterCenters = new Map<string, { x: number, y: number }>();
    clusterNodes.forEach(node => clusterCenters.set(node.id, { x: node.x, y: node.y }));

    // **Extract unique artist nodes**
    const artists: ArtistNode[] = filteredData.map(d => ({
      name: d.DisplayName,
      exhibition: d.ExhibitionTitle,
      cluster: clusterCenters.get(d.ExhibitionTitle),
      x: Math.random() * 800,
      y: Math.random() * 500
    }));

    const width = 800, height = 500, radius = 3;

    const svg = chartContainer.append<SVGSVGElement>("svg")
      .attr("width", width)
      .attr("height", height);

    const g = svg.append<SVGGElement>("g");

    // **Artist simulation**
    const simulation = d3.forceSimulation<ArtistNode>(artists)
      .force("x", d3.forceX(d => (d as ArtistNode).cluster?.x ?? width / 2).strength(0.1))
      .force("y", d3.forceY(d => (d as ArtistNode).cluster?.y ?? height / 2).strength(0.1))
      .force("collide", d3.forceCollide(radius + 3))
      .on("tick", ticked);

    const colorScale = d3.scaleOrdinal(d3.schemeCategory10)
      .domain(Array.from(exhibitionCounts.keys()));

    // **Append artist circles**
    const circles = g.selectAll("circle.artist")
      .data(artists)
      .enter()
      .append("circle")
      .attr("class", "artist")
      .attr("r", radius)
      .attr("fill", d => colorScale(d.exhibition));

    // **Append aggregated group circles**
    const aggregatedGroups = g.selectAll("circle.group")
      .data(clusterNodes)
      .enter()
      .append("circle")
      .attr("class", "group")
      .attr("cx", d => d.x)
      .attr("cy", d => d.y)
      .attr("r", d => d.size)
      .attr("fill", d => colorScale(d.id))
      .attr("opacity", 0.6);

    const labels = g.selectAll(".artist-label")
      .data(artists)
      .enter()
      .append("text")
      .attr("class", "artist-label")
      .attr("font-size", "2px")
      .attr("fill", "#000")
      .attr("text-anchor", "middle")
      .attr("alignment-baseline", "middle")
      .text(d => d.name)
      .style("opacity", 0); // Hidden initially

    // **Show artist label on hover, hide on mouseout**
    circles.on("mouseover", function (event, d) {
      d3.select(this).attr("stroke", "#000").attr("stroke-width", 2);
      labels.filter(l => l.name === d.name).style("opacity", 1);
    })
      .on("mouseout", function (event, d) {
        d3.select(this).attr("stroke", "none");
        labels.filter(l => l.name === d.name).style("opacity", 0);
      });

    // **Append cluster (exhibition) labels**
    const clusterLabels = g.selectAll(".cluster-label")
      .data(clusterNodes)
      .enter()
      .append("text")
      .attr("class", "cluster-label")
      .attr("x", d => d.x)
      .attr("y", d => d.y)
      .text(d => d.id.length > 12 ? d.id.substring(0, 12) + "..." : d.id)
      .attr("fill", "#444")
      .attr("font-size", "12px")
      .attr("font-weight", "bold")
      .attr("text-anchor", "middle")
      .style("opacity", 0.8);

    function ticked() {
      circles.attr("cx", d => d.x!).attr("cy", d => d.y!);
      labels.attr("x", d => d.x!).attr("y", d => d.y!);
      clusterLabels.attr("x", d => clusterCenters.get(d.id)!.x).attr("y", d => clusterCenters.get(d.id)!.y);
    }

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 10])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        const zoomLevel = event.transform.k;
        clusterLabels.style("opacity", zoomLevel <= 2.5 ? 1.0 : 0);
        aggregatedGroups.style("opacity", 0.4);
        circles.style("opacity", zoomLevel > 2.5 ? 1 : 0);
      });

    svg.call(zoom).call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2));
  }
}
