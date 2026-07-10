import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsIn } from 'class-validator';

const CHAINS = ['ethereum', 'bsc', 'polygon'] as const;
const CONTRACTS = ['INRX', 'EGOLD', 'ESLVR', 'TREASURY_TIMELOCK', 'BRIDGE_V2', 'RESERVE_VAULT', 'ORACLE_MANAGER'] as const;

export class GrantRoleDto {
  @ApiProperty({ enum: CHAINS })
  @IsIn(CHAINS)
  chain!: string;

  @ApiProperty({ enum: CONTRACTS })
  @IsIn(CONTRACTS)
  contract!: string;

  @ApiProperty({ example: 'MINTER_ROLE' })
  @IsString() @IsNotEmpty()
  role!: string;

  @ApiProperty({ example: '0x028c268e79a725a8f3ede12d6f2a6cafb6fbcb60' })
  @IsString() @IsNotEmpty()
  address!: string;
}