# Helix Stay -- the Hotel SP. Catalog: book:hotel. Entirely independent of
# the Airline SP: its own DID, its own status list, its own grants.
from helixid_config import HOTEL
from sp_shared.serve import serve_sp

if __name__ == "__main__":
    serve_sp(HOTEL)
