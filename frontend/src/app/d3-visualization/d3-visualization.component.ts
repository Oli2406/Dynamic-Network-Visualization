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
  @Input() showOnlyFuzzyExhibitions: boolean = false;
  @Input() aggregationMode: string = 'fullDetail';
  csvData: any[] = [];
  @ViewChild('chartContainer', { static: false }) chartContainer!: ElementRef;

  private savedTransform: d3.ZoomTransform = d3.zoomIdentity;

  constructor(private el: ElementRef) {}

  ngAfterViewInit() {
    setTimeout(() => {
      this.loadCSVData();
    }, 100);
  }

  ngOnChanges(changes: SimpleChanges) {
    const yearChanged = changes['pickedYear'];
    const fuzzyToggleChanged = changes['showOnlyFuzzyExhibitions'];
    const aggregationModeChanged = changes['aggregationMode'];

    const shouldUpdate =
      (yearChanged && yearChanged.currentValue !== yearChanged.previousValue) ||
      (fuzzyToggleChanged && fuzzyToggleChanged.previousValue !== undefined) ||
      (aggregationModeChanged && aggregationModeChanged.previousValue !== undefined);

    if (shouldUpdate && this.csvData.length > 0) {
      this.updateVisualization();
    }
  }

  loadCSVData() {
    function normalizeName(name: string): string {
      return name ? name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : "";
    }

    Promise.all([
      d3.csv('assets/MoMAExhibitions1929to1989_normalized.csv'),
      d3.csv('assets/fuzzy_memberships_postfiltered_exhibition_based.csv')
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
        const fuzzy = fuzzyMap.get(fuzzyKey);

        if (!fuzzy) return null;
        const fikVals = Object.keys(fuzzy).filter(k => k.startsWith('fik_C')).map(k => +fuzzy[k]);
        const maxFik = Math.max(...fikVals);
        const fuzziness = 1 - maxFik;

        return { ...d, Year: year, ...fuzzy };
      }).filter(d => d !== null);


      this.updateVisualization();
    }).catch(error => console.error('Error loading CSVs:', error));
  }

  // TODO: LOD aggregation for huge groups needed, vary radius based on number of groups
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
      radius?: number;
    }

    const filteredData = this.csvData.filter(d => {
      const year = d['ExhibitionBeginDate'] ? new Date(d['ExhibitionBeginDate']).getFullYear() : null;
      return year === this.pickedYear;
    });

    const fuzzyExhibitions = new Set<string>();
    filteredData.forEach(d => {
      if (d['IsFuzzy'] === "True") {
        d['ExhibitionTitle'].split("|").forEach((ex: string) => {
          fuzzyExhibitions.add(ex.trim());
        });
      }
    });

    const chartContainer = d3.select<HTMLElement, unknown>(this.chartContainer.nativeElement);
    chartContainer.html("");

    if (filteredData.length === 0) {
      chartContainer.append("p").text("No exhibitions found for this year.").style("color", "red");
      return;
    }

    const tooltip = chartContainer.append("div")
      .style("position", "absolute")
      .style("padding", "4px 8px")
      .style("background", "white")
      .style("border", "1px solid #ccc")
      .style("border-radius", "4px")
      .style("pointer-events", "none")
      .style("font-size", "12px")
      .style("box-shadow", "0 2px 4px rgba(0,0,0,0.1)")
      .style("opacity", 0);

    const width = 1920;
    const height = 900;
    const nodeRadius = 4;

    const artistNodeMap = new Map<string, ArtistNode>();
    const exhibitionMap = new Map<string, Set<string>>();

    filteredData.forEach(d => {
      const name = d['DisplayName'];
      const exhibitions = d['ExhibitionTitle'].split("|").map((e: string) => e.trim());
      const isFuzzy = d['IsFuzzy'] === "True";
      const id = name;

      if (!artistNodeMap.has(id)) {
        const fikKeys = Object.keys(d).filter(k => k.startsWith("fik_C"));
        const fikValues = fikKeys.map(k => +d[k]);
        const maxFik = Math.max(...fikValues);
        const predominantIndex = fikValues.indexOf(maxFik);
        const predominantCommunity = `C${predominantIndex + 1}`;
        const fuzziness = isFuzzy ? 1 : 0;

        artistNodeMap.set(id, {
          id,
          name,
          exhibition: exhibitions.join("|"),
          x: 0,
          y: 0,
          predominantCommunity,
          fuzziness,
          fik: fikValues
        });
      }

      exhibitions.forEach((ex: string) => {
        if (!exhibitionMap.has(ex)) exhibitionMap.set(ex, new Set());
        exhibitionMap.get(ex)!.add(id);
      });
    });

    const filteredExhibitionMap = new Map(
      Array.from(exhibitionMap.entries()).filter(([ex]) => fuzzyExhibitions.has(ex))
    );

    const currentMap = this.showOnlyFuzzyExhibitions ? filteredExhibitionMap : exhibitionMap;
    const currentExhibitions = Array.from(currentMap.keys());


    const clusterCenters = new Map<string, { x: number; y: number }>();
    const groupSizes = Array.from(exhibitionMap.values()).map(set => set.size);
    const totalSize = d3.sum(groupSizes);
    const groupAngleScales = groupSizes.map(size => (size / totalSize) * 2 * Math.PI);

    const cumulativeAngles: number[] = [];
    groupAngleScales.reduce((acc, angle, i) => {
      cumulativeAngles[i] = acc;
      return acc + angle;
    }, 0);

    const minSize = d3.min(groupSizes)!;
    const maxSize = d3.max(groupSizes)!;

    const radiusScale = d3.scaleSqrt()
      .domain([minSize, maxSize])
      .range([3, 100]);

    const metaNodeRadii = currentExhibitions.map(ex => {
      const groupSize = currentMap.get(ex)!.size;
      return radiusScale(groupSize);
    });

    const paddingBetweenNodes = 50;
    const totalCircumference = d3.sum(metaNodeRadii, r => 2 * r + paddingBetweenNodes);
    const layoutRadius = totalCircumference / (2 * Math.PI) + 50;

    currentExhibitions.forEach((ex, i) => {
      const angle = cumulativeAngles[i] + groupAngleScales[i] / 2;
      clusterCenters.set(ex, {
        x: width / 2 + Math.cos(angle) * layoutRadius,
        y: height / 2 + Math.sin(angle) * layoutRadius
      });
    });

    const allNodes: ArtistNode[] = [];
    const links: { source: ArtistNode; target: ArtistNode }[] = [];
    const linkSet = new Set<string>();

    // === Layout and core-core linking ===
    currentMap.forEach((artistIds, ex) => {
      const center = clusterCenters.get(ex)!;

      const core: ArtistNode[] = [];
      const fuzzy: ArtistNode[] = [];

      artistIds.forEach(id => {
        const node = artistNodeMap.get(id)!;
        if (node.fuzziness === 0) core.push(node);
        else fuzzy.push(node);
      });

      const metaNodeRadius = radiusScale(artistIds.size);

      if (this.aggregationMode === "aggregateDisjoint") {
        const metaNode: ArtistNode = {
          id: `meta-${ex}`,
          name: `Meta: ${ex}`,
          exhibition: ex,
          x: center.x,
          y: center.y,
          predominantCommunity: "Meta",
          fuzziness: 0,
          fik: [],
          radius: metaNodeRadius
        };
        allNodes.push(metaNode);

        fuzzy.forEach(fuzzyNode => {
          const fuzzyExhibitions = fuzzyNode.exhibition.split("|").map(e => e.trim());
          if (fuzzyExhibitions.includes(ex)) {
            links.push({ source: fuzzyNode, target: metaNode });
          }
        });

        fuzzy.forEach(fuzzyNode => {
          const fuzzyExhibitions = fuzzyNode.exhibition.split("|").map(e => e.trim());
          const contributingCenters = fuzzyExhibitions.map(e => clusterCenters.get(e)).filter(Boolean) as { x: number, y: number }[];

          if (contributingCenters.length > 0) {
            const avgX = d3.mean(contributingCenters, c => c.x)!;
            const avgY = d3.mean(contributingCenters, c => c.y)!;
            const jitter = () => Math.random() * 40 - 10;
            fuzzyNode.x = avgX + jitter();
            fuzzyNode.y = avgY + jitter();
          } else {
            fuzzyNode.x = width / 2;
            fuzzyNode.y = height / 2;
          }

          allNodes.push(fuzzyNode);
        });

      } else {
        const thisClusterRadius = radiusScale(artistIds.size);

        const goldenAngle = Math.PI * (3 - Math.sqrt(5));

        core.forEach((node, i) => {
          const r = thisClusterRadius * Math.sqrt(i / core.length) * 0.9;
          const angle = i * goldenAngle;

          node.x = center.x + r * Math.cos(angle);
          node.y = center.y + r * Math.sin(angle);

          allNodes.push(node);
        });


        fuzzy.forEach(fuzzyNode => {
          const fuzzyExhibitions = fuzzyNode.exhibition.split("|").map(e => e.trim());
          const contributingCenters = fuzzyExhibitions.map(e => clusterCenters.get(e)).filter(Boolean) as { x: number, y: number }[];

          if (contributingCenters.length > 0) {
            const avgX = d3.mean(contributingCenters, c => c.x)!;
            const avgY = d3.mean(contributingCenters, c => c.y)!;
            const jitter = () => Math.random() * 40 - 10;
            fuzzyNode.x = avgX + jitter();
            fuzzyNode.y = avgY + jitter();
          } else {
            fuzzyNode.x = width / 2;
            fuzzyNode.y = height / 2;
          }

          allNodes.push(fuzzyNode);
        });

        for (let i = 0; i < core.length; i++) {
          for (let j = i + 1; j < core.length; j++) {
            links.push({ source: core[i], target: core[j] });
          }
        }
      }
    });

    if (this.aggregationMode !== 'aggregateDisjoint') {
      allNodes.forEach(fuzzy => {
        if (fuzzy.fuzziness !== 1) return;

        const exhibitions = fuzzy.exhibition.split("|").map(e => e.trim());
        const linkedExhibitions = new Set<string>();

        exhibitions.forEach(ex => {
          if (linkedExhibitions.has(ex)) return;

          const group = exhibitionMap.get(ex);
          if (!group) return;

          let closest: ArtistNode | undefined;
          let minDist = Infinity;

          group.forEach(id => {
            const other = artistNodeMap.get(id);
            if (!other || other.id === fuzzy.id || other.fuzziness !== 0) return;

            const dx = fuzzy.x - other.x;
            const dy = fuzzy.y - other.y;
            const dist = dx * dx + dy * dy;

            if (dist < minDist) {
              minDist = dist;
              closest = other;
            }
          });

          if (closest) {
            const key = `${fuzzy.id}→${closest.id}`;
            if (!linkSet.has(key)) {
              links.push({source: fuzzy, target: closest});
              linkSet.add(key);
              linkedExhibitions.add(ex);

            }
          }
        });
      });
    }

    const seen = new Set<string>();
    const uniqueNodes = allNodes.filter(n => {
      if (seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });

    const svg = chartContainer.append("svg")
      .attr("width", width)
      .attr("height", height)
      .style("background-color", "#fafafa");

    const defs = svg.append("defs");
    const g = svg.append("g");

    const color = d3.scaleOrdinal<string>()
      .domain(["C1", "C2", "C3", "C4", "C5", "C6"])
      .range(d3.schemeSet1);

    const sanitizeId = (str: string) => str.normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]/g, "_");

    function createRadialGradient(d: ArtistNode, colorFn: (c: string) => string): string {
      const gradientId = `gradient-${sanitizeId(d.id)}`;
      if (!defs.select(`#${gradientId}`).empty()) return `url(#${gradientId})`;

      const grad = defs.append("radialGradient")
        .attr("id", gradientId)
        .attr("fx", "50%").attr("fy", "50%");

      const exhibitions = d.exhibition.split("|").map(e => e.trim());
      const numColors = exhibitions.length;

      exhibitions.forEach((ex, i) => {
        const offsetStart = (i / numColors) * 100;
        const offsetEnd = ((i + 1) / numColors) * 100;
        const stopColor = colorFn(ex);

        grad.append("stop")
          .attr("offset", `${offsetStart}%`)
          .attr("stop-color", stopColor)
          .attr("stop-opacity", 0.2);

        grad.append("stop")
          .attr("offset", `${offsetEnd}%`)
          .attr("stop-color", stopColor)
          .attr("stop-opacity", 1);
      });
      return `url(#${gradientId})`;
    }

    const uniqueCommunities = new Set(uniqueNodes.map(n => n.predominantCommunity));
    const isSingleCommunity = uniqueCommunities.size === 1;
    const onlyCommunity = [...uniqueCommunities][0] ?? "C1";

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
      .attr("stroke-dasharray", d =>
        (d.source.fuzziness ?? 0) > 0 || (d.target.fuzziness ?? 0) > 0 ? "3,2" : "0"
      )
      .attr("stroke-opacity", d =>
        d.source === d.target ? 0.3 : 1
      )
      .attr("stroke-width", d => d.source === d.target ? 0.3 : 0.1);

    const nodeElements = g.selectAll("circle.node")
      .data(uniqueNodes)
      .enter()
      .append("circle")
      .attr("class", "node")
      .attr("r", d => d.radius ?? nodeRadius)
      .attr("cx", d => d.x)
      .attr("cy", d => d.y)
      .attr("fill", d => {
        const baseColor = color(d.exhibition.split("|")[0]);
        return d.fuzziness && d.fuzziness > 0
          ? createRadialGradient(d, ex => color(ex))
          : baseColor;
      })
      .attr("stroke", "none")
      .attr("stroke-width", 0)
      .on("mouseover", (event, d) => {
        tooltip
          .style("opacity", 1)
          .html(`<strong>${d.name}</strong><br><em>${d.exhibition}</em>`);
      })
      .on("mousemove", event => {
        tooltip.style("left", (event.pageX + 10) + "px").style("top", (event.pageY - 20) + "px");
      })
      .on("mouseout", () => tooltip.style("opacity", 0))
      .on("click", function (event, clickedNode) {
        event.stopPropagation();

        const connectedIds = new Set<string>();
        const relevantLinks: typeof links = [];

        if (clickedNode.fuzziness === 1) {
          const directlyLinkedCores: ArtistNode[] = [];

          links.forEach(link => {
            const isFuzzyLink =
              (link.source.id === clickedNode.id && link.target.fuzziness === 0) ||
              (link.target.id === clickedNode.id && link.source.fuzziness === 0);

            if (isFuzzyLink) {
              relevantLinks.push(link);
              connectedIds.add(link.source.id);
              connectedIds.add(link.target.id);

              const coreNode = link.source.fuzziness === 0 ? link.source : link.target;
              directlyLinkedCores.push(coreNode);
            }
          });

          directlyLinkedCores.forEach(coreNode => {
            links.forEach(link => {
              const isCoreCore =
                link.source.fuzziness === 0 &&
                link.target.fuzziness === 0 &&
                (link.source.id === coreNode.id || link.target.id === coreNode.id);

              if (isCoreCore) {
                relevantLinks.push(link);
                connectedIds.add(link.source.id);
                connectedIds.add(link.target.id);
              }
            });
          });

        } else {
          links.forEach(link => {
            const isDirect =
              (link.source.id === clickedNode.id || link.target.id === clickedNode.id);

            if (isDirect) {
              relevantLinks.push(link);
              connectedIds.add(link.source.id);
              connectedIds.add(link.target.id);
            }
          });
        }

        linkElements
          .attr("stroke-opacity", d => relevantLinks.includes(d) ? 1 : 0.05)
          .attr("stroke-width", d => relevantLinks.includes(d) ? 0.5 : 0.1);

        nodeElements.attr("opacity", d => connectedIds.has(d.id) ? 1 : 0.05);
      });


    svg.on("click", event => {
      if ((event.target as SVGElement).tagName === "circle") return;

      linkElements.attr("stroke-opacity", 1).attr("stroke-width", 0.1);
      nodeElements.attr("opacity", 1);
    });

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
      .attr("stroke-width", 0.5)
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

    lineSvg.append("g")
      .attr("transform", `translate(0,${lineHeight - lineMargin.bottom})`)
      .call(d3.axisBottom(x).tickFormat(() => "").ticks(0));

    lineSvg.append("g")
      .attr("transform", `translate(${lineMargin.left},0)`)
      .call(d3.axisLeft(y).tickFormat(() => "").ticks(0));


    const linkVisibilityThreshold = 0.1;
    let currentTransform: d3.ZoomTransform = d3.zoomIdentity;

    function updateLinkVisibility() {
      if (!linkElements) return;

      const scale = currentTransform.k;

      if (scale < linkVisibilityThreshold) {
        linkElements.attr("display", "none");
        return;
      }

      const [tx, ty] = [currentTransform.x, currentTransform.y];
      const scaleInv = 1 / scale;

      const viewX0 = -tx * scaleInv;
      const viewY0 = -ty * scaleInv;
      const viewX1 = viewX0 + width * scaleInv;
      const viewY1 = viewY0 + height * scaleInv;

      linkElements.attr("display", d => {
        const inView =
          d.source.x >= viewX0 && d.source.x <= viewX1 &&
          d.source.y >= viewY0 && d.source.y <= viewY1 &&
          d.target.x >= viewX0 && d.target.x <= viewX1 &&
          d.target.y >= viewY0 && d.target.y <= viewY1;

        return inView ? "inline" : "none";
      });
    }

    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 5])
        .on("zoom", event => {
          currentTransform = event.transform;
          g.attr("transform", currentTransform.toString());
          this.savedTransform = event.transform;
          // makes sure to only render visible links
          //updateLinkVisibility();
        })
    );
  }
}
