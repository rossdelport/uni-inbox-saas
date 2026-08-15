-- Cover the remaining queue foreign keys so deleting an account or user does
-- not require a table scan while Postgres cascades its pending mailbox moves.
create index mailbox_move_ops_owner_idx
  on uni_inbox.mailbox_move_ops (owner_id);

create index mailbox_move_ops_account_idx
  on uni_inbox.mailbox_move_ops (account_id);
