"""Read the configured Sicoob account balance for authorized finance users."""
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
import re
import subprocess
from threading import Lock
import time

from sicoob_sync import Queue

READER = Path('/opt/energetica-whatsapp/sicoob-movements/Read-SicoobBalance.ps1')


class SicoobBalance:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.lock = Lock()
        self.expires_at = -1
        self.balance = None

    def read(self):
        with self.lock:
            if self.clock() >= self.expires_at:
                self.balance = self.fetch()
                self.expires_at = self.clock() + 10
            return self.balance

    @staticmethod
    def fetch():
        try:
            result = subprocess.run(['pwsh', '-NoLogo', '-NoProfile', '-NonInteractive', '-File', str(READER)],
                                    stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=22)
        except (OSError, subprocess.TimeoutExpired):
            return None
        amount = result.stdout.strip()
        if result.returncode or not re.fullmatch(r'-?[0-9]{1,13}(?:[.,][0-9]{1,2})?', amount):
            return None
        cents = int(Decimal(amount.replace(',', '.')) * 100)
        as_of = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
        return {'balanceCents': cents, 'asOf': as_of}


SERVICE = SicoobBalance()


def handle_portal(identity, body, *, queue=None, service=SERVICE):
    if body != {'action': 'sicoob_balance'}:
        raise ValueError('Consulta de saldo Sicoob inválida.')
    (queue or Queue()).authorize(identity)
    return {'status': 'processed', 'messages': [], 'sicoobBalance': service.read()}
