"""candidate judgments: stored tick-sheet + score breakdown

Revision ID: 1055b1e14fe7
Revises: b22a93d2dffb
Create Date: 2026-07-27 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1055b1e14fe7'
down_revision: Union[str, Sequence[str], None] = 'b22a93d2dffb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('candidates', schema=None) as batch_op:
        batch_op.add_column(sa.Column('judgments', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('candidates', schema=None) as batch_op:
        batch_op.drop_column('judgments')
