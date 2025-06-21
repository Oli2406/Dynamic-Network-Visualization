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
      d3.csv('assets/fuzzy_memberships_by_year.csv')
    ]).then(([rawData, fuzzyData]) => {
      const fuzzyMap = new Map<string, any>();
      fuzzyData.forEach(d => {
        const name = normalizeName(d['DisplayName']);
        const year = d['Year'];
        if (name && year) {
          fuzzyMap.set(`${name}_${year}`, d);
        }
      });

      this.csvData = rawData.map(d => {
        const normalizedName = normalizeName(d['DisplayName']);
        const year = d['ExhibitionBeginDate'] ? new Date(d['ExhibitionBeginDate']).getFullYear() : null;
        const fuzzyKey = `${normalizedName}_${year}`;
        const fuzzy = fuzzyMap.get(fuzzyKey) || {};
        return { ...d, Year: year, ...fuzzy };
      });

      this.updateVisualization();
    }).catch(error => console.error('Error loading CSVs:', error));
  }

  updateVisualization() {
    if (!this.pickedYear || this.csvData.length === 0) return;

    // === Artist node structure definition ===
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

    // === Filter CSV data for the selected year ===
    const filteredData = this.csvData.filter(d => {
      const year = d['ExhibitionBeginDate'] ? new Date(d['ExhibitionBeginDate']).getFullYear() : null;
      return year === this.pickedYear;
    });

    const chartContainer = d3.select<HTMLElement, unknown>(this.chartContainer.nativeElement);
    chartContainer.html(""); // Clear previous render

    if (filteredData.length === 0) {
      chartContainer.append("p").text("No exhibitions found for this year.").style("color", "red");
      return;
    }

    // === Tooltip setup ===
    const tooltip = chartContainer
      .append("div")
      .style("position", "absolute")
      .style("padding", "4px 8px")
      .style("background", "white")
      .style("border", "1px solid #ccc")
      .style("border-radius", "4px")
      .style("pointer-events", "none")
      .style("font-size", "12px")
      .style("box-shadow", "0 2px 4px rgba(0,0,0,0.1)")
      .style("opacity", 0);

    const width = 1300;
    const height = 900;
    const nodeRadius = 3;
    const layoutRadius = 300;
    const fuzzinessThreshold = 0.4;

    // === Organize artist nodes by exhibition title ===
    const exhibitionMap = new Map<string, ArtistNode[]>();
    filteredData.forEach(d => {
      const id = `${d['DisplayName']}_${d['ExhibitionTitle']}`;
      const fikKeys = Object.keys(d).filter(k => k.startsWith("fik_C"));
      const fikValues = fikKeys.map(k => +d[k]);
      const maxFik = Math.max(...fikValues);
      const predominantIndex = fikValues.indexOf(maxFik);
      const predominantCommunity = `C${predominantIndex + 1}`;
      const fuzziness = 1 - maxFik;

      if (!exhibitionMap.has(d['ExhibitionTitle'])) {
        exhibitionMap.set(d['ExhibitionTitle'], []);
      }

      exhibitionMap.get(d['ExhibitionTitle'])!.push({
        id,
        name: d['DisplayName'],
        exhibition: d['ExhibitionTitle'],
        x: 0,
        y: 0,
        predominantCommunity,
        fuzziness,
        fik: fikValues
      });
    });

    // === Layout centers for each exhibition group ===
    const exhibitions = Array.from(exhibitionMap.keys());
    const clusterCenters = new Map<string, { x: number; y: number }>();
    exhibitions.forEach((ex, i) => {
      const angle = (2 * Math.PI * i) / exhibitions.length;
      clusterCenters.set(ex, {
        x: width / 2 + Math.cos(angle) * layoutRadius,
        y: height / 2 + Math.sin(angle) * layoutRadius
      });
    });

    // === Scale cluster radius by size of group ===
    const groupSizes = Array.from(exhibitionMap.values()).map(nodes => nodes.length);
    const minSize = d3.min(groupSizes)!;
    const maxSize = d3.max(groupSizes)!;
    const radiusScale = d3.scaleLinear().domain([minSize, maxSize]).range([30, 100]);

    const allNodes: ArtistNode[] = [];
    const links: { source: ArtistNode; target: ArtistNode }[] = [];

    // === Layout core and fuzzy nodes ===
    exhibitionMap.forEach((nodes, ex) => {
      const center = clusterCenters.get(ex)!;
      const thisClusterRadius = radiusScale(nodes.length);

      const core = nodes.filter(n => n.fuzziness !== undefined && n.fuzziness < fuzzinessThreshold);
      const fuzzy = nodes.filter(n => n.fuzziness !== undefined && n.fuzziness >= fuzzinessThreshold);

      // === Place core nodes randomly inside cluster circle ===
      core.forEach((node) => {
        const angle = Math.random() * 2 * Math.PI;
        const radius = Math.sqrt(Math.random()) * thisClusterRadius;
        node.x = center.x + Math.cos(angle) * radius;
        node.y = center.y + Math.sin(angle) * radius;
        allNodes.push(node);
      });

      // === Place fuzzy nodes by averaging community cluster centers ===
      fuzzy.forEach(fuzzy => {
        if (!fuzzy.fik || fuzzy.fik.length === 0 || fuzzy.fik.every(val => isNaN(val))) {
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
          fuzzy.x = width / 2 + Math.random() * 100 - 50;
          fuzzy.y = height / 2 + Math.random() * 100 - 50;
        }

        allNodes.push(fuzzy);
      });

      // === Create links between all core members in same group ===
      for (let i = 0; i < core.length; i++) {
        for (let j = i + 1; j < core.length; j++) {
          links.push({ source: core[i], target: core[j] });
        }
      }
    });

    // === Add fuzzy node links to strongest matching community core ===
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

    // === SVG container setup ===
    const svg = chartContainer.append("svg")
      .attr("width", width)
      .attr("height", height)
      .style("background-color", "#fafafa");

    const defs = svg.append("defs");
    const g = svg.append("g");

    // === Community color scale ===
    const color = d3.scaleOrdinal<string>()
      .domain(["C1", "C2", "C3", "C4", "C5", "C6"])
      .range(d3.schemeCategory10);

    // === Helper to generate unique gradient IDs ===
    const sanitizeId = (str: string) => str.normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]/g, "_");

    // === Gradient fill generator for fuzzy nodes ===
    function createRadialGradient(d: ArtistNode, baseColor: string): string {
      const gradientId = `gradient-${sanitizeId(d.id)}`;
      if (!defs.select(`#${gradientId}`).empty()) return `url(#${gradientId})`;

      const grad = defs.append("radialGradient").attr("id", gradientId);
      grad.append("stop").attr("offset", "0%").attr("stop-color", "#fff");
      grad.append("stop").attr("offset", "100%").attr("stop-color", baseColor);
      return `url(#${gradientId})`;
    }

    // === Color unification for single-community views ===
    const uniqueCommunities = new Set(allNodes.map(n => n.predominantCommunity));
    const isSingleCommunity = uniqueCommunities.size === 1;
    const onlyCommunity = [...uniqueCommunities][0] ?? "C1";
    const hasFuzzyNodes = allNodes.some(n => n.fuzziness && n.fuzziness > fuzzinessThreshold);

    // === Draw artist nodes ===
    const linkElements = g.selectAll("line.link")
      .data(links)
      .enter()
      .append("line")
      .attr("class", "link")
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y)
      .attr("stroke", "black")
      .attr("stroke-dasharray", d => d.source.fuzziness && d.source.fuzziness > fuzzinessThreshold ? "3,2" : "0")
      .attr("stroke-width", 1);

    const nodeElements = g.selectAll("circle.node")
      .data(allNodes)
      .enter()
      .append("circle")
      .attr("class", "node")
      .attr("r", nodeRadius)
      .attr("cx", d => d.x)
      .attr("cy", d => d.y)
      .attr("fill", d => {
        const baseColor = isSingleCommunity
          ? color(onlyCommunity)
          : color(d.predominantCommunity || "C1");

        return hasFuzzyNodes && d.fuzziness && d.fuzziness > fuzzinessThreshold
          ? createRadialGradient(d, baseColor)
          : baseColor;
      })
      .on("mouseover", (event, d) => {
        tooltip
          .style("opacity", 1)
          .html(`<strong>${d.name}</strong>`);
      })
      .on("mousemove", (event) => {
        tooltip
          .style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY - 20) + "px");
      })
      .on("mouseout", () => {
        tooltip.style("opacity", 0);
      })
      .on("click", function (event, clickedNode) {
        event.stopPropagation();

        const connectedIds = new Set<string>();
        links.forEach(link => {
          if (link.source.id === clickedNode.id) {
            connectedIds.add(link.target.id);
          } else if (link.target.id === clickedNode.id) {
            connectedIds.add(link.source.id);
          }
        });
        connectedIds.add(clickedNode.id);
        linkElements
          .attr("stroke-opacity", d =>
            d.source.id === clickedNode.id || d.target.id === clickedNode.id ? 1 : 0.1)
          .attr("stroke-width", d =>
            d.source.id === clickedNode.id || d.target.id === clickedNode.id ? 2 : 1);

        nodeElements
          .attr("opacity", d => connectedIds.has(d.id) ? 1 : 0.2);
      });

    // === Reset on background click ===
    svg.on("click", (event) => {
      if ((event.target as SVGElement).tagName === "circle") return;

      linkElements
        .attr("stroke-opacity", 1)
        .attr("stroke-width", 1);

      nodeElements
        .attr("opacity", 1);
    });


    // === Centered line chart for exhibitions per year ===
    const yearsMap = d3.rollup(this.csvData, v => v.length, d => +d['Year']);
    const lineData = Array.from(yearsMap.entries())
      .filter(([year]) => !isNaN(year))
      .sort((a, b) => a[0] - b[0]);

    const lineMargin = { top: 10, right: 30, bottom: 20, left: 30 };
    const lineHeight = 120;
    const lineWidth = width;

    const x = d3.scaleLinear()
      .domain(d3.extent(lineData, d => d[0]) as [number, number])
      .range([lineMargin.left, lineWidth - lineMargin.right]);

    const y = d3.scaleLinear()
      .domain([0, d3.max(lineData, d => d[1])!])
      .nice()
      .range([lineHeight - lineMargin.bottom, lineMargin.top]);

    const lineSvg = chartContainer.append("svg")
      .attr("width", lineWidth)
      .attr("height", lineHeight)
      .style("position", "absolute")
      .style("bottom", "0")
      .style("left", "50%")
      .style("transform", "translateX(-50%)")
      .style("background", "#fff");

    const line = d3.line<[number, number]>()
      .x(d => x(d[0]))
      .y(d => y(d[1]));

    lineSvg.append("path")
      .datum(lineData)
      .attr("fill", "none")
      .attr("stroke", "#007acc")
      .attr("stroke-width", 2)
      .attr("d", line);

// === Add dots with tooltips ===
    const tooltip1 = chartContainer.append("div")
      .style("position", "absolute")
      .style("padding", "4px 8px")
      .style("background", "white")
      .style("border", "1px solid #ccc")
      .style("border-radius", "4px")
      .style("pointer-events", "none")
      .style("font-size", "12px")
      .style("box-shadow", "0 2px 4px rgba(0,0,0,0.1)")
      .style("opacity", 0);

    lineSvg.selectAll("circle")
      .data(lineData)
      .enter()
      .append("circle")
      .attr("cx", d => x(d[0]))
      .attr("cy", d => y(d[1]))
      .attr("r", 4)
      .attr("fill", "#007acc")
      .on("mouseover", (event, d) => {
        tooltip1
          .style("opacity", 1)
          .html(`<strong>${d[0]}</strong>: ${d[1]} exhibitions`);
      })
      .on("mousemove", (event) => {
        tooltip1
          .style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY - 20) + "px");
      })
      .on("mouseout", () => tooltip1.style("opacity", 0));

// === Remove axis ticks ===
    lineSvg.append("g")
      .attr("transform", `translate(0,${lineHeight - lineMargin.bottom})`)
      .call(d3.axisBottom(x).tickFormat(() => "").ticks(0));

    lineSvg.append("g")
      .attr("transform", `translate(${lineMargin.left},0)`)
      .call(d3.axisLeft(y).tickFormat(() => "").ticks(0));


    // === Enable zooming and panning ===
    svg.call(d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 5])
      .on("zoom", event => g.attr("transform", event.transform)));
  }
}
