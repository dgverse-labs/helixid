# Helix Air -- the Airline SP. Catalog: book:flights, modify:booking.
from helixid_config import AIRLINE
from sp_shared.serve import serve_sp

if __name__ == "__main__":
    serve_sp(AIRLINE)
