"""campaign rubric_key

Revision ID: bf3fe87525fc
Revises: 0db983aba19a
Create Date: 2026-07-29 17:55:50.173281

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bf3fe87525fc'
down_revision: Union[str, Sequence[str], None] = '0db983aba19a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
