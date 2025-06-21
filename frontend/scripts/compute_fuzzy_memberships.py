import pandas as pd
import networkx as nx
from sklearn.decomposition import PCA
import skfuzzy as fuzz
from collections import defaultdict

# Load data
input_file = "MoMAExhibitions1929to1989.csv"
output_file = "fuzzy_memberships_postfiltered_exhibition_based.csv"
df = pd.read_csv(input_file, encoding="latin1")

# Clean and prepare
df["ExhibitionBeginDate"] = pd.to_datetime(df["ExhibitionBeginDate"], errors="coerce")
df["Year"] = df["ExhibitionBeginDate"].dt.year
years = sorted(df["Year"].dropna().unique().astype(int))

# Config
n_clusters = 4
min_artists_per_year = 5
fuzziness_threshold = 0.95
all_memberships = []

def normalize_name(name):
    return name.strip().lower() if isinstance(name, str) else ""

for year in years:
    df_year = df[df["Year"] == year]
    if df_year.empty:
        continue

    # Track which artist exhibited where
    artist_to_exhibitions = defaultdict(set)
    for _, row in df_year.iterrows():
        artist = normalize_name(row['DisplayName'])
        exhibition = row['ExhibitionTitle']
        if pd.notna(artist) and pd.notna(exhibition):
            artist_to_exhibitions[artist].add(exhibition)

    # Split artists into single- and multi-exhibition groups
    single_exhibition_artists = {a for a, e in artist_to_exhibitions.items() if len(e) == 1}
    multi_exhibition_artists = {a for a, e in artist_to_exhibitions.items() if len(e) > 1}

    # Hard-assign single-exhibition artists
    for artist in single_exhibition_artists:
        ex = next(iter(artist_to_exhibitions[artist]))
        membership = {f"fik_C{i+1}": 0 for i in range(n_clusters)}
        membership["DisplayName"] = artist
        membership["Year"] = year
        membership["ExhibitionTitle"] = ex
        membership["IsFuzzy"] = False
        membership["fik_C1"] = 1  # Assign all singles to C1 by default
        all_memberships.append(pd.DataFrame([membership]))

    # Fuzzy cluster multi-exhibition artists
    if len(multi_exhibition_artists) >= n_clusters:
        # Build bipartite graph without duplicates
        B = nx.Graph()
        for artist, exhibitions in artist_to_exhibitions.items():
            if artist in multi_exhibition_artists:
                artist_node = f"A_{artist}"
                B.add_node(artist_node, type="artist")
                for exhibition in exhibitions:
                    exhibition_node = f"E_{exhibition}"
                    B.add_node(exhibition_node, type="exhibition")
                    B.add_edge(artist_node, exhibition_node)

        artists = [n for n, d in B.nodes(data=True) if d['type'] == 'artist']
        if len(artists) < n_clusters:
            continue

        G = nx.bipartite.weighted_projected_graph(B, artists)
        if G.number_of_nodes() < n_clusters:
            continue

        adj = nx.to_numpy_array(G, nodelist=artists)
        pca = PCA(n_components=min(5, adj.shape[0]))
        X = pca.fit_transform(adj)

        cntr, u, _, _, _, _, _ = fuzz.cluster.cmeans(
            X.T, c=n_clusters, m=2, error=0.005, maxiter=1000
        )

        memberships = pd.DataFrame(u.T, columns=[f"fik_C{i+1}" for i in range(n_clusters)])
        memberships["DisplayName"] = [a[2:] for a in artists]
        memberships["Year"] = year
        memberships["ExhibitionTitle"] = memberships["DisplayName"].map(
            lambda name: "|".join(artist_to_exhibitions[name])
        )
        memberships["IsFuzzy"] = True

        # Optional hard assignment
        max_vals = memberships[[f"fik_C{i+1}" for i in range(n_clusters)]].max(axis=1)
        max_cols = memberships[[f"fik_C{i+1}" for i in range(n_clusters)]].idxmax(axis=1)
        for i in range(len(memberships)):
            if max_vals.iloc[i] >= fuzziness_threshold:
                memberships.loc[i, [f"fik_C{i+1}" for i in range(n_clusters)]] = 0
                memberships.loc[i, max_cols.iloc[i]] = 1

        all_memberships.append(memberships)

# Combine and save
if all_memberships:
    final_df = pd.concat(all_memberships, ignore_index=True)
    final_df.to_csv(output_file, index=False)
    print(f"Saved to: {output_file}")
else:
    print("No data was processed. Check if input has any valid rows.")
