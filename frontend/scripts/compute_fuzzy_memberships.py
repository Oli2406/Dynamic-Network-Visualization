import pandas as pd
import networkx as nx
from sklearn.decomposition import PCA
import skfuzzy as fuzz

# === Load Data ===
input_file = "src/assets/MoMAExhibitions1929to1989.csv"
output_file = "fuzzy_memberships.csv"
df = pd.read_csv(input_file, encoding="latin1")

# === Create Bipartite Graph ===
B = nx.Graph()
for _, row in df.iterrows():
    artist = f"A_{row['DisplayName']}"
    exhibition = f"E_{row['ExhibitionTitle']}"
    B.add_node(artist, type='artist')
    B.add_node(exhibition, type='exhibition')
    B.add_edge(artist, exhibition)

# === Project to Artist–Artist Co-exhibition Graph ===
artists = [n for n, d in B.nodes(data=True) if d["type"] == "artist"]
G = nx.bipartite.weighted_projected_graph(B, artists)

# === Adjacency Matrix & Dimensionality Reduction ===
adj = nx.to_numpy_array(G, nodelist=artists)
pca = PCA(n_components=5)
X = pca.fit_transform(adj)

# === Fuzzy C-Means Clustering ===
n_clusters = 4  # You can change this number
cntr, u, _, _, _, _, _ = fuzz.cluster.cmeans(
    X.T, c=n_clusters, m=2, error=0.005, maxiter=1000
)

# === Save Fuzzy Memberships ===
memberships = pd.DataFrame(u.T, columns=[f"fik_C{i+1}" for i in range(n_clusters)])
memberships["DisplayName"] = [a[2:] for a in artists]  # remove prefix
memberships.to_csv(output_file, index=False)

print(f"Saved fuzzy memberships for {len(memberships)} artists to {output_file}")
