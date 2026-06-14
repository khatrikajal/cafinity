import os
from dotenv import load_dotenv
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Load .env then optional .env.local overrides for developer machines.
load_dotenv(BASE_DIR / ".env")
load_dotenv(BASE_DIR / ".env.local", override=True)

env = os.getenv("DJANGO_ENV", "dev")

if env == "prod":
    from .prod import *
elif env == "test":
    from .test import *
elif env == "local":
    from .local import *
else:
    from .base import *