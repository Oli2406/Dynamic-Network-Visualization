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
    function normalizeName(name: string): string {
      return name ? name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : "";
    }
    Promise.all([
      d3.csv('assets/MoMAExhibitions1929to1989_normalized.csv'),
      d3.csv('assets/fuzzy_memberships.csv')
    ]).then(([rawData, fuzzyData]) => {
      const fuzzyMap = new Map(
        fuzzyData.map(d => [normalizeName(d['DisplayName']), d])
      );
      this.csvData = rawData.map(d => {
        const normalizedName = normalizeName(d['DisplayName']);
        const fuzzy = fuzzyMap.get(normalizedName) || {};
        return { ...d, ...fuzzy };
      });

      this.updateVisualization();
    }).catch(error => console.error('Error loading CSVs:', error));
  }
  updateVisualization() {
    if (!this.pickedYear || this.csvData.length === 0) return;

    interface ArtistNode {
      id: string;
      name: string;
      exhibition: string;
      x: number;
      y: number;
      predominantCommunity?: string;
      fuzziness?: number;
      fik?: number[];
    }

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

    const width = 1000;
    const height = 700;
    const nodeRadius = 6;
    const clusterRadius = 60;
    const layoutRadius = 300;
    const fuzzinessThreshold = 0.4;

    const exhibitionMap = new Map<string, ArtistNode[]>();
    filteredData.forEach(d => {
      const id = `${d.DisplayName}_${d.ExhibitionTitle}`;
      const fikKeys = Object.keys(d).filter(k => k.startsWith("fik_C"));
      const fikValues = fikKeys.map(k => +d[k]);
      const maxFik = Math.max(...fikValues);
      const predominantIndex = fikValues.indexOf(maxFik);
      const predominantCommunity = `C${predominantIndex + 1}`;
      const fuzziness = 1 - maxFik;

      if (!exhibitionMap.has(d.ExhibitionTitle)) {
        exhibitionMap.set(d.ExhibitionTitle, []);
      }

      exhibitionMap.get(d.ExhibitionTitle)!.push({
        id,
        name: d.DisplayName,
        exhibition: d.ExhibitionTitle,
        x: 0,
        y: 0,
        predominantCommunity,
        fuzziness,
        fik: fikValues
      });
    });

    const exhibitions = Array.from(exhibitionMap.keys());
    const clusterCenters = new Map<string, { x: number; y: number }>();

    exhibitions.forEach((ex, i) => {
      const angle = (2 * Math.PI * i) / exhibitions.length;
      clusterCenters.set(ex, {
        x: width / 2 + Math.cos(angle) * layoutRadius,
        y: height / 2 + Math.sin(angle) * layoutRadius
      });
    });

    const allNodes: ArtistNode[] = [];
    const links: { source: ArtistNode; target: ArtistNode }[] = [];

    exhibitionMap.forEach((nodes, ex) => {
      const center = clusterCenters.get(ex)!;
      const core = nodes.filter(n => n.fuzziness !== undefined && n.fuzziness < fuzzinessThreshold);
      const fuzzy = nodes.filter(n => n.fuzziness !== undefined && n.fuzziness >= fuzzinessThreshold);

      const angleStep = (2 * Math.PI) / Math.max(core.length, 1);
      core.forEach((node, i) => {
        node.x = center.x + Math.cos(i * angleStep) * clusterRadius;
        node.y = center.y + Math.sin(i * angleStep) * clusterRadius;
        allNodes.push(node);
      });

      fuzzy.forEach(fuzzy => {
        if (!fuzzy.fik || fuzzy.fik.length === 0 || fuzzy.fik.every(val => isNaN(val))) {
          console.warn("Skipping fuzzy node with invalid fik:", fuzzy.name);
          fuzzy.x = width / 2 + Math.random() * 100 - 50;
          fuzzy.y = height / 2 + Math.random() * 100 - 50;
          allNodes.push(fuzzy);
          return;
        }

        const contributingCenters: { x: number; y: number }[] = [];
        fuzzy.fik.forEach((w, i) => {
          if (w > 0.1) {
            const c = `C${i + 1}`;
            for (const [ex2, center2] of clusterCenters) {
              if (exhibitionMap.get(ex2)!.some(n => n.predominantCommunity === c)) {
                contributingCenters.push(center2);
                break;
              }
            }
          }
        });

        if (contributingCenters.length > 0) {
          const avgX = d3.mean(contributingCenters, c => c.x)!;
          const avgY = d3.mean(contributingCenters, c => c.y)!;
          fuzzy.x = avgX + Math.random() * 50 - 25;
          fuzzy.y = avgY + Math.random() * 50 - 25;
        } else {
          console.warn("No valid community weights for fuzzy node:", fuzzy.name, fuzzy.fik);
          fuzzy.x = width / 2 + Math.random() * 100 - 50;
          fuzzy.y = height / 2 + Math.random() * 100 - 50;
        }

        allNodes.push(fuzzy);
      });

      for (let i = 0; i < core.length; i++) {
        for (let j = i + 1; j < core.length; j++) {
          links.push({ source: core[i], target: core[j] });
        }
      }
    });

    // Fuzzy node cross-links
    const fuzzyOnly = allNodes.filter(n => n.fuzziness && n.fuzziness >= fuzzinessThreshold);
    fuzzyOnly.forEach(fuzzy => {
      fuzzy.fik!.forEach((w, i) => {
        if (w > 0.1) {
          const c = `C${i + 1}`;
          const target = allNodes.find(n => n.predominantCommunity === c && n.fuzziness! < fuzzinessThreshold);
          if (target) links.push({ source: fuzzy, target });
        }
      });
    });

    // --- Rendering ---
    const svg = chartContainer.append("svg")
      .attr("width", width)
      .attr("height", height)
      .style("background-color", "#fafafa");

    const defs = svg.append("defs");
    const g = svg.append("g");

    const color = d3.scaleOrdinal<string>()
      .domain(["C1", "C2", "C3", "C4", "C5", "C6"])
      .range(d3.schemeCategory10);

    const sanitizeId = (str: string) => str.normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]/g, "_");

    function createRadialGradient(d: ArtistNode, baseColor: string): string {
      const gradientId = `gradient-${sanitizeId(d.id)}`;
      if (!defs.select(`#${gradientId}`).empty()) return `url(#${gradientId})`;

      const grad = defs.append("radialGradient").attr("id", gradientId);
      grad.append("stop").attr("offset", "0%").attr("stop-color", "#fff");
      grad.append("stop").attr("offset", "100%").attr("stop-color", baseColor);
      return `url(#${gradientId})`;
    }

    g.selectAll("line.link")
      .data(links)
      .enter()
      .append("line")
      .attr("class", "link")
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y)
      .attr("stroke", d => d.source.fuzziness && d.source.fuzziness > fuzzinessThreshold ? "#aaa" : "#ccc")
      .attr("stroke-dasharray", d => d.source.fuzziness && d.source.fuzziness > fuzzinessThreshold ? "3,2" : "0")
      .attr("stroke-width", 1);

    g.selectAll("circle.node")
      .data(allNodes)
      .enter()
      .append("circle")
      .attr("class", "node")
      .attr("r", nodeRadius)
      .attr("cx", d => d.x)
      .attr("cy", d => d.y)
      .attr("fill", d => {
        const baseColor = color(d.predominantCommunity || "C1");
        return d.fuzziness && d.fuzziness > fuzzinessThreshold
          ? createRadialGradient(d, baseColor)
          : baseColor;
      });

    g.selectAll("text.label")
      .data(allNodes)
      .enter()
      .append("text")
      .attr("x", d => d.x)
      .attr("y", d => d.y - 10)
      .attr("text-anchor", "middle")
      .text(d => d.name)
      .attr("font-size", "6px")
      .attr("fill", "#333")
      .style("opacity", 0);

    svg.call(d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 5])
      .on("zoom", event => g.attr("transform", event.transform)));
  }
}
