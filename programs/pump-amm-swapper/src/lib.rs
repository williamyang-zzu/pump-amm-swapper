use anchor_lang::prelude::*;

declare_id!("7vbo8W8myMRKZRogqsF5u4RwZtUhN7BaFJR41StrhPkU");

#[program]
pub mod pump_amm_swapper {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
