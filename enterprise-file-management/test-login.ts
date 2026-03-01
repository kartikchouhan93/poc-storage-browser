import prisma from './lib/prisma'; // Make sure this path is right or just use the generated client directly:
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  const user = await p.user.findUnique({
    where: { email: 'kumar.abhishk2510@gmail.com' },
    include: { policies: true, teams: { include: { team: { include: { policies: true } } } } }
  });
  console.log(JSON.stringify(user, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await p.$disconnect();
  });
