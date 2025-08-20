import { Component, ElementRef, AfterViewInit, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core';
import * as d3 from 'd3';

@Component({
  selector: 'app-d3-visualization',
  templateUrl: './d3-visualization.component.html',
  standalone: true,
  styleUrls: ['./d3-visualization.component.css']
})
export class D3VisualizationComponent implements AfterViewInit, OnChanges {
  @Input() pickedYear: number | null = 1932;
  @Input() showOnlyFuzzyExhibitions: boolean = true;
  @Input() aggregationMode: string = 'aggregateDisjoint';
  csvData: any[] = [];
  @ViewChild('chartContainer', { static: false }) chartContainer!: ElementRef;

  private selectedNodeId: string | null = null;
  private savedTransform: d3.ZoomTransform = d3.zoomIdentity;

  private stats: any | null = null;

  constructor(private el: ElementRef) {}

  private computeStats() {
    // Unique artists (by normalized DisplayName)
    const norm = (s: string) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const artistsSet = new Set<string>();
    const exYearSet = new Set<string>();
    const exPerYear = new Map<number, Set<string>>();
    const artistYearToEx = new Map<string, Set<string>>();
    const exYearToArtists = new Map<string, Set<string>>();
    const addToSetMap = <K, V>(m: Map<K, Set<V>>, k: K, v: V) => {
      if (!m.has(k)) m.set(k, new Set<V>());
      m.get(k)!.add(v);
    };

    this.csvData.forEach(d => {
      const year = +d['Year'];
      if (!year || isNaN(year)) return;

      const artist = norm(d['DisplayName']);
      if (!artist) return;
      artistsSet.add(artist);

      const exhibitions = String(d['ExhibitionTitle'] || "")
        .split("|")
        .map(e => e.trim())
        .filter(e => e.length > 0);

      exhibitions.forEach(ex => {
        const exYearKey = `${ex}|||${year}`;
        exYearSet.add(exYearKey);
        addToSetMap(exPerYear, year, ex);
        addToSetMap(exYearToArtists, exYearKey, artist);
      });

      const ayKey = `${artist}|||${year}`;
      exhibitions.forEach(ex => addToSetMap(artistYearToEx, ayKey, ex));
    });

    let multiSetCount = 0;
    let singleSetCount = 0;
    artistYearToEx.forEach(set => {
      if (set.size > 1) multiSetCount++;
      else singleSetCount++;
    });

    const clusterSizes: number[] = [];
    exYearToArtists.forEach(s => clusterSizes.push(s.size));
    clusterSizes.sort((a, b) => a - b);

    const denseThreshold = 50;
    const veryDenseCount = clusterSizes.filter(s => s >= denseThreshold).length;

    const mean = clusterSizes.length
      ? clusterSizes.reduce((a, b) => a + b, 0) / clusterSizes.length
      : 0;
    const median = clusterSizes.length
      ? (clusterSizes.length % 2
        ? clusterSizes[(clusterSizes.length - 1) / 2]
        : (clusterSizes[clusterSizes.length / 2 - 1] + clusterSizes[clusterSizes.length / 2]) / 2)
      : 0;

    const distributionOverTime = Array.from(exPerYear.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([year, set]) => ({ year, exhibitions: set.size }));

    this.stats = {
      totalExhibitions: exYearSet.size,
      totalArtists: artistsSet.size,
      distributionOverTime,
      singleArtistYears: singleSetCount,
      multiSetArtistYears: multiSetCount,
      clusterSize: {
        min: clusterSizes[0] ?? 0,
        max: clusterSizes[clusterSizes.length - 1] ?? 0,
        median: +median.toFixed(1),
        mean: +mean.toFixed(1),
      },
      veryDenseExhibitions: veryDenseCount,
      denseThreshold,
    };

    console.table(this.stats);
  }

  private renderStatsBox() {
    if (!this.stats || !this.chartContainer) return;

    const host = d3.select<HTMLElement, unknown>(this.chartContainer.nativeElement);

    host.selectAll(".stats-box").remove();

    const box = host.append("div")
      .attr("class", "stats-box")
      .style("position", "absolute")
      .style("top", "8px")
      .style("left", "8px")
      .style("padding", "8px 10px")
      .style("background", "rgba(255,255,255,0.95)")
      .style("border", "1px solid #ddd")
      .style("border-radius", "6px")
      .style("font", "12px/1.3 system-ui, -apple-system, Segoe UI, Roboto, sans-serif")
      .style("box-shadow", "0 2px 6px rgba(0,0,0,0.08)")
      .style("z-index", "10");

    const s = this.stats;

    box.html(`
    <div><strong>Dataset Overview</strong></div>
    <div>Total exhibitions: ${s.totalExhibitions.toLocaleString()}</div>
    <div>Total artists: ${s.totalArtists.toLocaleString()}</div>
    <div>Artist-years (single / multi-set): ${s.singleArtistYears.toLocaleString()} / ${s.multiSetArtistYears.toLocaleString()}</div>
    <div>Typical cluster size (min / median / mean / max): ${s.clusterSize.min} / ${s.clusterSize.median} / ${s.clusterSize.mean} / ${s.clusterSize.max}</div>
    <div>Very dense exhibitions (≥ ${s.denseThreshold}): ${s.veryDenseExhibitions}</div>
  `);
  }

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


      this.computeStats();
      this.renderStatsBox();

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
      radius?: number;
    }

    const filteredData = this.csvData.filter(d => {
      const year = d['ExhibitionBeginDate'] ? new Date(d['ExhibitionBeginDate']).getFullYear() : null;
      return year === this.pickedYear;
    });

    const fuzzyExhibitions = new Set<string>();
    filteredData.forEach(d => {
      if (d['IsFuzzy'] === "True") {
        d['ExhibitionTitle'].split("|").forEach((ex: string) => fuzzyExhibitions.add(ex.trim()));
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
      .style("font-size", "14px")
      .style("box-shadow", "0 2px 4px rgba(0,0,0,0.1)")
      .style("opacity", 0);

    const width = 1920;
    const height = 1080;
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

    const groupSizes = Array.from(exhibitionMap.values()).map(set => set.size);
    const minSize = d3.min(groupSizes)!;
    const maxSize = d3.max(groupSizes)!;

    const radiusScale = d3.scaleSqrt()
      .domain([minSize, maxSize])
      .range([3, 75]);

    const metaNodes: ArtistNode[] = currentExhibitions.map(ex => ({
      id: ex,
      name: `Meta: ${ex}`,
      exhibition: ex,
      x: width / 2,
      y: height / 2,
      predominantCommunity: "Meta",
      fuzziness: 0,
      fik: [],
      radius: radiusScale(currentMap.get(ex)!.size)
    }));

    const metaLinksMap = new Map<string, { source: string, target: string, value: number }>();
    filteredData.forEach(d => {
      if (d['IsFuzzy'] === "True") {
        const exhibitions = d['ExhibitionTitle'].split("|").map((e: string) => e.trim());
        for (let i = 0; i < exhibitions.length; i++) {
          for (let j = i + 1; j < exhibitions.length; j++) {
            const pairKey = [exhibitions[i], exhibitions[j]].sort().join("→");
            if (!metaLinksMap.has(pairKey)) {
              metaLinksMap.set(pairKey, { source: exhibitions[i], target: exhibitions[j], value: 0 });
            }
            metaLinksMap.get(pairKey)!.value += 1;
          }
        }
      }
    });

    const metaLinks = Array.from(metaLinksMap.values());

    const simulation = d3.forceSimulation(metaNodes)
      .force("link", d3.forceLink(metaLinks).id(d => (d as ArtistNode).id).strength(d => Math.min(1, d.value / 5)))
      .force("collide", d3.forceCollide().radius(d => ((d as ArtistNode).radius ?? 0) + 50))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .stop();

    for (let i = 0; i < 300; ++i) simulation.tick();

    const clusterCenters = new Map<string, { x: number; y: number }>();
    metaNodes.forEach(node => {
      clusterCenters.set(node.id, { x: node.x, y: node.y });
    });

    const allNodes: ArtistNode[] = [];
    const links: { source: ArtistNode; target: ArtistNode }[] = [];
    const linkSet = new Set<string>();
    const aggregatedExhibitions = new Set<string>();

    const layoutFuzzyNodesByMembership = (
      fuzzyNodes: ArtistNode[],
      clusterCenters: Map<string, { x: number; y: number }>
    ) => {
      const groupMap = new Map<string, ArtistNode[]>();

      fuzzyNodes.forEach(node => {
        const key = node.exhibition.split("|").sort().join("||");
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key)!.push(node);
      });

      const groupEntries = Array.from(groupMap.entries());

      groupEntries.forEach(([key, nodes], index) => {
        const exhibitions = key.split("||");
        const centers = exhibitions.map(ex => clusterCenters.get(ex)).filter(Boolean) as { x: number, y: number }[];

        if (centers.length === 0) return;

        const avgX = d3.mean(centers, c => c.x)!;
        const avgY = d3.mean(centers, c => c.y)!;

        const spacing = 1;
        const globalRadius = spacing * Math.sqrt(index + 1);
        const spreadAngle = (2 * Math.PI * index) / groupEntries.length;

        const offsetX = globalRadius * Math.cos(spreadAngle);
        const offsetY = globalRadius * Math.sin(spreadAngle);

        const centerX = avgX + offsetX;
        const centerY = avgY + offsetY;

        nodes.forEach((node, i) => {
          const gridSize = Math.ceil(Math.sqrt(nodes.length));
          const col = i % gridSize;
          const row = Math.floor(i / gridSize);

          node.x = centerX + (col - gridSize / 2);
          node.y = centerY + (row - gridSize / 2);
        });

      });
    };

    function pushFuzzyOutsideClusters(fuzzyNodes: ArtistNode[], metaNodes: ArtistNode[], padding: number = 10) {
      fuzzyNodes.forEach(fuzzy => {
        metaNodes.forEach(meta => {
          if (fuzzy.exhibition.includes(meta.exhibition)) return;

          const dx = fuzzy.x - meta.x;
          const dy = fuzzy.y - meta.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const safeDist = (fuzzy.radius ?? 4) + (meta.radius ?? 0) + padding;

          if (dist < safeDist && dist > 0.01) {
            const offset = (safeDist - dist) / dist;
            fuzzy.x += dx * offset * 0.5;
            fuzzy.y += dy * offset * 0.5;
          }
        });
      });
    }

    function enforceFuzzyCollision(
      fuzzyNodes: ArtistNode[],
      coreNodes: ArtistNode[],
      padding: number = 10
    ) {
      fuzzyNodes.forEach(fuzzy => {
        coreNodes.forEach(core => {
          const dx = fuzzy.x - core.x;
          const dy = fuzzy.y - core.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          const minDist = (fuzzy.radius ?? 4) + (core.radius ?? 4) + padding;
          if (dist < minDist && dist > 0.001) {
            const offset = (minDist - dist) / dist;
            fuzzy.x += dx * offset * 0.5;
            fuzzy.y += dy * offset * 0.5;
          }
        });
      });
    }

    function repelFuzzyNodes(nodes: ArtistNode[]) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = (a.radius ?? 4) + (b.radius ?? 4);

          if (dist < minDist && dist > 0.001) {
            const offset = (minDist - dist) / dist * 0.5;
            const moveX = dx * offset;
            const moveY = dy * offset;

            a.x += moveX;
            a.y += moveY;
            b.x -= moveX;
            b.y -= moveY;
          }
        }
      }
    }

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
      const aggregationThreshold = 50;

      if (this.aggregationMode === "aggregateDisjoint" || artistIds.size > aggregationThreshold) {
        aggregatedExhibitions.add(ex);

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

        fuzzy.forEach(f => {
          links.push({ source: f, target: metaNode });
        });

        layoutFuzzyNodesByMembership(fuzzy, clusterCenters);

        for (let i = 0; i < 3; i++) {
          pushFuzzyOutsideClusters(fuzzy, metaNodes);
          enforceFuzzyCollision(fuzzy, [metaNode]);
          repelFuzzyNodes(fuzzy);
        }

        allNodes.push(...fuzzy);

      } else {
        if (core.length === 0 && fuzzy.length > 0) {
          const anchorNode: ArtistNode = {
            id: `anchor-${ex}`,
            name: `Anchor: ${ex}`,
            exhibition: ex,
            x: center.x,
            y: center.y,
            predominantCommunity: "Meta",
            fuzziness: 0,
            fik: [],
            radius: metaNodeRadius * 0.5
          };
          allNodes.push(anchorNode);
          links.push(...fuzzy.map(f => ({ source: f, target: anchorNode })));

          layoutFuzzyNodesByMembership(fuzzy, clusterCenters);

          for (let i = 0; i < 3; i++) {
            pushFuzzyOutsideClusters(fuzzy, metaNodes);
            enforceFuzzyCollision(fuzzy, [anchorNode]);
            repelFuzzyNodes(fuzzy);
          }

          allNodes.push(...fuzzy);

        } else {
          const goldenAngle = Math.PI * (3 - Math.sqrt(5));
          core.forEach((node, i) => {
            const r = metaNodeRadius * Math.sqrt(i / core.length);
            const angle = i * goldenAngle;
            node.x = center.x + r * Math.cos(angle);
            node.y = center.y + r * Math.sin(angle);
            allNodes.push(node);
          });

          for (let i = 0; i < core.length; i++) {
            for (let j = i + 1; j < core.length; j++) {
              links.push({ source: core[i], target: core[j] });
            }
          }

          layoutFuzzyNodesByMembership(fuzzy, clusterCenters);

          for (let i = 0; i < 3; i++) {
            pushFuzzyOutsideClusters(fuzzy, metaNodes);
            enforceFuzzyCollision(fuzzy, core);
            repelFuzzyNodes(fuzzy);
          }

          allNodes.push(...fuzzy);
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
          if (aggregatedExhibitions.has(ex)) return;

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
      .attr("width", "100%")
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
      .on("click", (event, clickedNode)=> {

        this.selectedNodeId = clickedNode.id;
        event.stopPropagation();

        d3.select(".meta-info-box").remove();

        const isMetaNode = clickedNode.id.startsWith("meta-");
        if (isMetaNode) {
          const exhibition = clickedNode.exhibition;

          const artistList = Array.from(exhibitionMap.get(exhibition) || [])
            .map(id => artistNodeMap.get(id))
            .filter(n => n && n.fuzziness !== undefined) as ArtistNode[];

          artistList.sort((a, b) => a.name.localeCompare(b.name));

          const overlay = chartContainer.append("div")
            .attr("class", "meta-info-overlay")
            .on("click", () => {
              d3.select(".meta-info-overlay").remove();
              d3.select(".meta-info-box").remove();
            });

          const infoBox = overlay.append("div")
            .attr("class", "meta-info-box");

          infoBox.append("div")
            .attr("class", "meta-info-title")
            .html(`"${exhibition}"<br>Displaying ${artistList.length} artists`);


          artistList.forEach(artist => {
            infoBox.append("div").attr("class", "meta-info-artist").text(artist.name);
          });

          return;
        }

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

      d3.select(".meta-info-box").remove();

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

    let currentTransform: d3.ZoomTransform = d3.zoomIdentity;

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 5])
      .on("zoom", event => {
        currentTransform = event.transform;
        g.attr("transform", currentTransform.toString());
        this.savedTransform = event.transform;
      });
    svg.call(zoom);
    svg.call(zoom.transform, this.savedTransform);
    this.computeStats();
    this.renderStatsBox();
  }
}
