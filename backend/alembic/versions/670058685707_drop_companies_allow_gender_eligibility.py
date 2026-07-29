"""drop companies.allow_gender_eligibility

Revision ID: 670058685707
Revises: 1055b1e14fe7
Create Date: 2026-07-29 15:56:53.493872

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '670058685707'
down_revision: Union[str, Sequence[str], None] = '1055b1e14fe7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("companies") as batch_op:
        batch_op.drop_column("allow_gender_eligibility")


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("companies") as batch_op:
        batch_op.add_column(
            sa.Column(
                "allow_gender_eligibility",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
