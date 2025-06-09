import pandas as pd
import networkx as nx
from sklearn.decomposition import PCA
import skfuzzy as fuzz

# === Load Data ===
input_file = "MoMAExhibitions1929to1989.csv"
output_file = "fuzzy_memberships_by_year.csv"
df = pd.read_csv(input_file, encoding="latin1")

# === Get Unique Years ===
df["ExhibitionBeginDate"] = pd.to_datetime(df["ExhibitionBeginDate"], errors="coerce")
df["Year"] = df["ExhibitionBeginDate"].dt.year
years = sorted(df["Year"].dropna().unique().astype(int))

# === Config ===
n_clusters = 4
min_artists_per_year = 5
all_memberships = []

# === Normalize Name Helper ===
def normalize_name(name):
    return name.strip().lower() if isinstance(name, str) else ""

# === Loop Over Years ===
for year in years:
    df_year = df[df["Year"] == year]
    if df_year.empty:
        continue

    # Build bipartite graph for this year
    B = nx.Graph()
    for _, row in df_year.iterrows():
        artist = f"A_{normalize_name(row['DisplayName'])}"
        exhibition = f"E_{row['ExhibitionTitle']}"
        B.add_node(artist, type='artist')
        B.add_node(exhibition, type='exhibition')
        B.add_edge(artist, exhibition)

    artists = [n for n, d in B.nodes(data=True) if d['type'] == 'artist']
    if len(artists) < min_artists_per_year:
        continue

    # Project to artist–artist co-exhibition graph
    G = nx.bipartite.weighted_projected_graph(B, artists)

    if G.number_of_nodes() < n_clusters:
        continue

    # Adjacency and PCA
    adj = nx.to_numpy_array(G, nodelist=artists)
    pca = PCA(n_components=min(5, adj.shape[0]))
    X = pca.fit_transform(adj)

    # Fuzzy clustering
    cntr, u, _, _, _, _, _ = fuzz.cluster.cmeans(
        X.T, c=n_clusters, m=2, error=0.005, maxiter=1000
    )

    # Save fuzzy membership
    memberships = pd.DataFrame(u.T, columns=[f"fik_C{i+1}" for i in range(n_clusters)])
    memberships["DisplayName"] = [a[2:] for a in artists]
    memberships["Year"] = year
    all_memberships.append(memberships)

# === Save Combined Data ===
final_df = pd.concat(all_memberships, ignore_index=True)
final_df.to_csv(output_file, index=False)
print(f"Saved per-year fuzzy memberships to {output_file}")
